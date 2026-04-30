namespace TorqueMPMaster;

using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using TorqueMPCommon;

//import * as udp from 'dgram'
//import * as fs from 'fs-extra'
//import * as path from 'path'
//import * as os from 'os'
//import { BufferReader } from './bufferreader';
//import { BufferWriter } from './bufferwriter';

using number = double;

public sealed class Settings
{
	public string masterIp;
	public string masterExternalIp;
	public string relayIp;
	public string[] banlist;
	public string apiServer;
}

public sealed class MPServer
{
	public IPEndPoint endpoint;
	//public IPAddress address;
	//public int port;
	public DateTime timestamp;
	public Info info;

	public sealed class Info
	{
		public string gameType;
		public string missionType;
		public string inviteCode;
		public number maxPlayers;
		public uint regionMask;
		public number version;
		public byte filterFlag;
		public number botCount;
		public number cpuSpeed;
		public number playerCount;
		public List<number> guidList;
	}
}

public sealed class  ArrangedClient
{
	public IPEndPoint endpoint;
	//public IPAddress address;
	//public int port;
	public number id;
}

public sealed class RelayServer {
	public IPEndPoint endpoint;
	//public IPAddress address;
	//public int port;
	public number connected;
	public DateTime timestamp;
}

enum PacketType
{
	MasterServerGameTypesRequest = 2,
	MasterServerGameTypesResponse = 4,
	MasterServerListRequest = 6,
	MasterServerListResponse = 8,
	GameMasterInfoRequest = 10,
	GameMasterInfoResponse = 12,
	GamePingRequest = 14,
	GamePingResponse = 16,
	GameInfoRequest = 18,
	GameInfoResponse = 20,
	GameHeartbeat = 22,
	MasterServerInfoRequest = 24,
	MasterServerInfoResponse = 26,
	MasterServerRequestArrangedConnection = 46,
	MasterServerClientRequestedArrangedConnection = 48,
	MasterServerAcceptArrangedConnection = 50,
	MasterServerArrangedConnectionAccepted = 52,
	MasterServerRejectArrangedConnection = 54,
	MasterServerArrangedConnectionRejected = 56,
	MasterServerGamePingRequest = 58,
	MasterServerGamePingResponse = 60,
	MasterServerGameInfoRequest = 62,
	MasterServerGameInfoResponse = 64,
	MasterServerRelayRequest = 66,
	MasterServerRelayResponse = 68,
	RelayDelete = 70,
	MasterServerRelayReady = 72,
	MasterServerJoinInvite = 74,
	MasterServerJoinInviteResponse = 76,
	RelayHeartbeat = 78,
}

// Basically the master server for multiplayer, gives out a list of available servers to the game
public sealed class MPMasterServer
{
	private static uint currentClientId = 0;

	private sealed class GameRequest
	{
		public IPEndPoint endpoint;
		//public IPAddress address;
		//public int port;
		public byte[] reqip;
		public number reqport;
	}
	public sealed class RelayRequest
	{
		public IPEndPoint endpoint;
		//public IPAddress address;
		//public int port;
		public RelayServer relay;
		public MPServer mpserver;
	}
	private UdpClient socket;
	private List<MPServer> serverList = [];
	private List<ArrangedClient> arrangedClients = [];
	private Dictionary<number, GameRequest> gamePingRequests = new();
	private Dictionary<number, GameRequest> gameInfoRequests = new();
	private Dictionary<number, RelayRequest> gameRelayRequests = new();
	private List<RelayServer> relayServers = [];
	private Timer updateInterval;
	private Task messages;
	private List<IPAddress> localIps = [];
	private readonly HashSet<IPAddress> banlistSet = new();

	// Starts the Multiplayer Master Server
	public void initialize()
	{
		//this.socket = udp.createSocket("udp4");

		var settings = JsonSerializer.Deserialize<Settings>(File.ReadAllText("settings.json"));
		this.banlistSet.Clear();
		foreach(var entry in settings.banlist)
		{
			banlistSet.Add(IPAddress.Parse(entry));
		}

		var hostsplit = settings.masterIp.Split(':'); // Naive but works for now
		var hostname = hostsplit[0];
		var port = int.Parse(hostsplit[1]);

		// Get our local IPs so we can resolve 127.0.0.1
		foreach(var iface in NetworkInterface.GetAllNetworkInterfaces())
		{
			if (iface.Supports(NetworkInterfaceComponent.IPv4))
			{
				this.localIps.Add(iface.GetPhysicalAddress());
			}
		}

		// Banlist updating
		var watcher = new FileSystemWatcher("settings.json")
		{
			NotifyFilter = NotifyFilters.LastWrite,
		};
		watcher.Changed += (s,e) =>
		{
			if(e.ChangeType == WatcherChangeTypes.Changed)
			{
				try
				{
					var newSettings = JsonSerializer.Deserialize<Settings>(File.ReadAllText("settings.json"));
					this.banlistSet.Clear();
					foreach(var entry in newSettings.banlist)
					{
						banlistSet.Add(IPAddress.Parse(entry));
					}
					Console.WriteLine("Reloaded settings.json");
				}
				catch(Exception)
				{
					// Pass
				}
			}
		};

		//this.socket.on("message", (msg, rinfo) => this.onMessage(msg, rinfo));
		//this.socket.on("error", (err) => this.onError(err));

		this.socket = new UdpClient(hostname, port);
		messages = new(() =>
		{
			while(true)
			{
				onMessage();
			}
		});
		messages.Start();
		this.updateInterval = new(this.update, null, 10000, 10000);
	}

	public MPServer? findServer(IPAddress ip, int port)
	{
		if(ip == IPAddress.Loopback)
		{
			foreach(var localip in this.localIps)
			{
				var s = this.serverList.Find(x => x.endpoint.Address == localip && (port == 0 || x.endpoint.Port == port));
				if (s != null)
				{
					return s;
				}
			}
		}
		else
		{
			return this.serverList.Find(x => x.endpoint.Address == ip && (port == 0 || x.endpoint.Port == port));
		}
		return null;
	}

	public void update(object? state)
	{
		this.serverList = this.serverList.Where(server =>
		{
			if (server.timestamp + TimeSpan.FromSeconds(10) < DateTime.Now)
			{
				Console.WriteLine($"Purging {server.endpoint} due to inactivity");
				return false; // Purge old servers
			}
			if (this.banlistSet.Contains(server.endpoint.Address))
			{
				Console.WriteLine($"Purging {server.endpoint} due to ban");
				return false;
			}
			return true;
		}).ToList();
		this.relayServers = this.relayServers.Where(server =>
		{
			if (server.timestamp + TimeSpan.FromSeconds(10) < DateTime.Now)
			{
				Console.WriteLine($"Purging Relay {server.endpoint} due to inactivity");
				return false; // Purge old servers
			}
			if (this.banlistSet.Contains(server.endpoint.Address))
			{
				Console.WriteLine($"Purging Relay {server.endpoint} due to ban");
				return false;
			}
			return true;
		}).ToList();
	}

	// Stops the server
	public void dispose()
	{
		this.updateInterval.Dispose();
		this.socket.Close();
	}

	// Received on error
	public void onError(Exception err)
	{
		Console.WriteLine(err);
	}

	// Received when someone sends a message
	public void onMessage()
	{
		//Buffer msg, udp.RemoteInfo rinfo
		IPEndPoint? rinfo = null;
		var msg = this.socket.Receive(ref rinfo);

		//TODO: onError

		var br = new BufferReader(msg);

		if(this.banlistSet.Contains(rinfo.Address))
		{
			return;
		}

		var cmd = (PacketType)br.readU8();

		Console.WriteLine($"{cmd} command received from {rinfo.Address}:{rinfo.Port}");

		if (cmd == PacketType.MasterServerListRequest) { //MasterServerListRequest

			var queryFlags = br.readU8();
			var key = br.readU32();
			var dummy = br.readU8();
			var gameType = br.readString();
			var missionType = br.readString();
			var minPlayers = br.readU8();
			var maxPlayers = br.readU8();
			var regionMask = br.readU32();
			var version = br.readU32();
			var filterFlag = br.readU8();
			var maxBots = br.readU8();
			var minCPU = br.readU16();
			var buddyCount = br.readU8();

			Console.WriteLine($"Query: {{ gameType: \"{gameType}\", missionType: \"{missionType}\", minPlayers: {minPlayers}, maxPlayers: {maxPlayers}, regionMask: {regionMask}, version: {version}, filterFlag: {filterFlag}, maxBots: {maxBots}, minCPU: {minCPU}, buddyCount: {buddyCount} }}");

			var sendServerList = this.serverList.Where(x => {
				return (x.info.filterFlag & 8) == 0 &&
					(x.info.playerCount < x.info.maxPlayers) &&
					(x.endpoint.Address != rinfo.Address) && 
					(x.info.gameType == gameType || gameType == "") &&
					(x.info.missionType == missionType || missionType == "" || missionType == "any") &&
					(x.info.playerCount >= minPlayers) &&
					(x.info.playerCount <= maxPlayers) &&
					((x.info.version >= version) || (version == 0)) && 
					(x.info.regionMask & regionMask)!=0 &&
					(x.info.cpuSpeed >= minCPU || minCPU == 0);
			}).ToList(); // Show only remote public servers with available slots

			if (sendServerList.Count > 0) {
				var packettotal = sendServerList.Count;
				var packetindex = 0;
				sendServerList.ForEach(serverinfo =>
				{
					var serverendpoint = serverinfo.endpoint;

					var now = DateTime.Now;

					// Check for refresh
					if (now > serverinfo.timestamp + TimeSpan.FromSeconds(90)) {

						// Check if its alive
						var buf1 = new BufferWriter();
						buf1.writeUInt8((byte)PacketType.GameMasterInfoRequest);
						buf1.writeUInt8(queryFlags);
						buf1.writeUInt32(key);
						var sendbuf1 = buf1.getBuffer();
						this.socket.Send(sendbuf1, serverendpoint); // GameMasterInfoRequest
					}

					var ipbits = serverendpoint.Address.GetAddressBytes();

					var isLocal = serverendpoint.Address == rinfo.Address;

					var buf = new BufferWriter();
					buf.writeUInt8((byte)PacketType.MasterServerListResponse); // MasterServerListResponse
					buf.writeUInt8(isLocal ? (byte)1 : (byte)0); // We are using flags to let know whether the server is local or not
					buf.writeUInt32(key);
					buf.writeUInt8((byte)packetindex);
					buf.writeUInt8((byte)packettotal);
					buf.writeUInt16((ushort)packettotal);
					buf.writeUInt8(ipbits[0]);
					buf.writeUInt8(ipbits[1]);
					buf.writeUInt8(ipbits[2]);
					buf.writeUInt8(ipbits[3]);
					buf.writeUInt16((ushort)serverendpoint.Port);

					packetindex++;

					var sendbuf = buf.getBuffer();

					this.socket.Send(sendbuf, rinfo);

				});

			} else {
				var buf = new BufferWriter();
				buf.writeUInt8((byte)PacketType.MasterServerListResponse); // MasterServerListResponse
				buf.writeUInt8(0);
				buf.writeUInt32(key);
				buf.writeUInt8(0);
				buf.writeUInt8(0);
				buf.writeUInt16(0);
				buf.writeUInt8(0);
				buf.writeUInt8(0);
				buf.writeUInt8(0);
				buf.writeUInt8(0);
				buf.writeUInt16(0);

				var sendbuf = buf.getBuffer();

				this.socket.Send(sendbuf, rinfo);
			}
		}

		if (cmd == PacketType.GameMasterInfoResponse) {
			var flags = br.readU8();
			var key = br.readU32();
			var gameType = br.readString();
			var missionType = br.readString();
			var inviteCode = br.readString();
			var maxPlayers = br.readU8();
			var regionMask = br.readU32();
			var version = br.readU32();
			var filterFlag = br.readU8();
			var botCount = br.readU8();
			var cpuSpeed = br.readU32();
			var playerCount = br.readU8();
			List<number> guidList = [];
			for (int i = 0; i < playerCount; i++)
			{
				guidList.Add(br.readU32());
			}
			
			var info = new MPServer.Info
			{
				gameType = gameType,
				missionType = missionType,
				inviteCode = inviteCode,
				maxPlayers = maxPlayers,
				regionMask = regionMask,
				version = version,
				filterFlag = filterFlag,
				botCount = botCount,
				cpuSpeed = cpuSpeed,
				playerCount = playerCount,
				guidList = guidList,
			};

			Console.WriteLine($"Server Info ({rinfo}): {{ gameType: \"{gameType}\", missionType: \"{missionType}\", maxPlayers: {maxPlayers}, regionMask: {regionMask}, version: {version}, filterFlag: {filterFlag}, botCount: {botCount}, cpuSpeed: {cpuSpeed} }}");

			var found = false;
			var insaddr = rinfo.Address;
			if (this.localIps.Contains(insaddr))
			{
				insaddr = IPAddress.Loopback;
			}
			for(int i = 0; i < this.serverList.Count; i++)
			{
				if (this.serverList[i].endpoint == rinfo)
				{
					this.serverList[i].info = info;
					this.serverList[i].timestamp = DateTime.Now;
					found = true;
					break;
				}
			}

			if(!found)
			{
				var insaddr2 = rinfo.Address;
				if (this.localIps.Contains(insaddr2))
				{
					insaddr2 = IPAddress.Loopback;
				}
				var serverInfo = new MPServer
				{
					endpoint = new(insaddr2, rinfo.Port),
					info = info,
					timestamp = DateTime.Now,
				};

				this.serverList.Add(serverInfo);
			}
		}

		if (cmd == PacketType.GameHeartbeat) { // GameHeartbeat
			var found = false;
			var flags = br.readU8();
			var key = br.readU32();
			for(int i = 0; i < this.serverList.Count; i++) {
				if (this.serverList[i].endpoint == rinfo) {
					this.serverList[i].timestamp = DateTime.Now;
					found = true;

					// Get their info
					var buf = new BufferWriter();
					buf.writeUInt8((byte)PacketType.GameMasterInfoRequest);
					buf.writeUInt8(flags);
					buf.writeUInt32(key);
					var sendbuf = buf.getBuffer();
					this.socket.Send(sendbuf,  rinfo); // GameMasterInfoRequest
					break;
				}
			}

			if (!found) {
				var serverInfo = new MPServer
				{
					endpoint = rinfo,
					info = null,
					timestamp = DateTime.Now,
				};

				// Get their info
				var buf = new BufferWriter();
				buf.writeUInt8((byte)PacketType.GameMasterInfoRequest);
				buf.writeUInt8(flags);
				buf.writeUInt32(key);
				var sendbuf = buf.getBuffer();
				this.socket.Send(sendbuf, rinfo); // GameMasterInfoRequest

				this.serverList.Add(serverInfo);
			}
		}

		if (cmd == PacketType.MasterServerRequestArrangedConnection) {
			byte[] ipbits = [br.readU8(), br.readU8(), br.readU8(), br.readU8()];
			var address = new IPAddress(ipbits);
			var port = br.readU16();
			var connectserver = this.findServer(address, port);
			Console.WriteLine(this.serverList);
			Console.WriteLine(address);
			if (connectserver == null) {
				var buf = new BufferWriter();
				buf.writeUInt8((byte)PacketType.MasterServerArrangedConnectionRejected);
				buf.writeUInt8(0); // Flags
				buf.writeUInt32(0); // Key
				buf.writeUInt8(0); // 0 = unknown host
				var sendbuf = buf.getBuffer();
				this.socket.Send(sendbuf, rinfo); // MasterServerRejectArrangedConnectRequest
			} else {
				Console.WriteLine($"{rinfo.Address}:{rinfo.Port} Requesting connection to {connectserver.endpoint}");

				var possibleAddresses = new (IPAddress address,int port)[]
				{
					(address: rinfo.Address, port: rinfo.Port + 2),
					(address: rinfo.Address, port: rinfo.Port + 1),
					(address: rinfo.Address, port: rinfo.Port),
				};

				var clientid = currentClientId++;

				this.arrangedClients.Add(new ArrangedClient
				{
					endpoint = rinfo,
					id = clientid,
				});
				
				var buf = new BufferWriter();
				buf.writeUInt8((byte)PacketType.MasterServerClientRequestedArrangedConnection);
				buf.writeUInt8(0); // Flags
				buf.writeUInt32(0); // Key
				buf.writeUInt16((ushort)clientid);
				buf.writeUInt8((byte)possibleAddresses.Length);
				foreach(var addr in possibleAddresses)
				{
					var ipbits1 = addr.address.GetAddressBytes();
					buf.writeUInt8(ipbits1[0]);
					buf.writeUInt8(ipbits1[1]);
					buf.writeUInt8(ipbits1[2]);
					buf.writeUInt8(ipbits1[3]);
					buf.writeUInt16((ushort)addr.port);
				}
				var sendbuf = buf.getBuffer();
				this.socket.Send(sendbuf, connectserver.endpoint);
			}
		}

		if (cmd == PacketType.MasterServerAcceptArrangedConnection) {
			var clientId = br.readU16();
			var client = this.arrangedClients.Find(x => x.id == clientId);
			if (client != null) {
				var possibleAddresses = new (IPAddress address,int port)[]
				{
					(address: rinfo.Address, port: rinfo.Port + 2),
					(address: rinfo.Address, port: rinfo.Port + 1),
					(address: rinfo.Address, port: rinfo.Port),
				};

				var buf = new BufferWriter();
				buf.writeUInt8((byte)PacketType.MasterServerArrangedConnectionAccepted);
				buf.writeUInt8(0); // Flags
				buf.writeUInt32(0); // Key
				buf.writeUInt8((byte)possibleAddresses.Length);
				foreach(var addr in possibleAddresses) {
					var ipbits = addr.address.GetAddressBytes();
					buf.writeUInt8(ipbits[0]);
					buf.writeUInt8(ipbits[1]);
					buf.writeUInt8(ipbits[2]);
					buf.writeUInt8(ipbits[3]);
					buf.writeUInt16((ushort)addr.port);
				}
				var sendbuf = buf.getBuffer();
				this.socket.Send(sendbuf, client.endpoint);
			}
		}

		if (cmd == PacketType.MasterServerRejectArrangedConnection) {
			var clientId = br.readU16();
			var client = this.arrangedClients.Find(x => x.id == clientId);
			if (client != null) {
				var buf = new BufferWriter();
				buf.writeUInt8((byte)PacketType.MasterServerArrangedConnectionRejected);
				buf.writeUInt8(0); // flags
				buf.writeUInt32(0); // Key
				buf.writeUInt8(1); // 1 = Server Rejected
				var sendbuf = buf.getBuffer();
				this.socket.Send(sendbuf, client.endpoint);
			}
		}

		if (cmd == PacketType.MasterServerGamePingRequest) {
			byte[] ipbits = [br.readU8(), br.readU8(), br.readU8(), br.readU8()];
			var port = br.readU16();
			var flags = br.readU8();
			var key = br.readU32();
			var address = new IPAddress(ipbits);
			var connectserver = this.findServer(address, port);
			if (connectserver != null) {
				Console.WriteLine($"Pinging {address} key {key} {flags}");
				this.gamePingRequests[key] = new()
				{
					endpoint = rinfo,
					reqip = ipbits,
					reqport = connectserver.endpoint.Port
				};
				var buf = new BufferWriter();
				buf.writeUInt8((byte)PacketType.GamePingRequest);
				buf.writeUInt8(flags);
				buf.writeUInt32(key);
				var sendbuf = buf.getBuffer();
				this.socket.Send(sendbuf, connectserver.endpoint); // We relay?
			}
		}

		if (cmd == PacketType.MasterServerGameInfoRequest) {
			byte[] ipbits = [br.readU8(), br.readU8(), br.readU8(), br.readU8()];
			var port = br.readU16();
			var flags = br.readU8();
			var key = br.readU32();
			var address = new IPAddress(ipbits);
			var connectserver = this.findServer(address, port);
			if (connectserver != null) {
				Console.WriteLine($"Requesting info from {address} key {key} {flags}");
				this.gameInfoRequests[key] = new()
				{
					endpoint = rinfo,
					reqip = ipbits,
					reqport = connectserver.endpoint.Port
				};
				var buf = new BufferWriter();
				buf.writeUInt8((byte)PacketType.GameInfoRequest);
				buf.writeUInt8(flags);
				buf.writeUInt32(key);
				var sendbuf = buf.getBuffer();
				this.socket.Send(sendbuf, connectserver.endpoint); // We relay?
			}
		}

		if (cmd == PacketType.GamePingResponse) {
			var flags = br.readU8();
			var key = br.readU32();
			var pr = this.gamePingRequests.GetValueOrDefault(key);
			Console.WriteLine($"Key {key} {flags}");
			if (pr != null) {
				Console.WriteLine($"Got ping response for {pr.endpoint.Address}");
				var buf = new BufferWriter();
				buf.writeUInt8((byte)PacketType.MasterServerGamePingResponse);
				var ipbits = pr.reqip;
				buf.writeUInt8(flags); // Key
				buf.writeUInt32(key); // Flags
				buf.writeUInt8(ipbits[0]);
				buf.writeUInt8(ipbits[1]);
				buf.writeUInt8(ipbits[2]);
				buf.writeUInt8(ipbits[3]);
				buf.writeUInt16((ushort)pr.reqport);
				buf.appendBuffer(msg);
				var sendbuf = buf.getBuffer();
				this.socket.Send(sendbuf, pr.endpoint);
				this.gamePingRequests.Remove(key);
			}
		}

		if (cmd == PacketType.GameInfoResponse) {
			var flags = br.readU8();
			var key = br.readU32();
			var pr = this.gameInfoRequests.GetValueOrDefault(key);
			Console.WriteLine($"Key {key} {flags}");
			if (pr != null) {
				Console.WriteLine($"Got game info response for {pr.endpoint.Address}");
				var buf = new BufferWriter();
				buf.writeUInt8((byte)PacketType.MasterServerGameInfoResponse);
				var ipbits = pr.reqip;
				buf.writeUInt8(flags); // Key
				buf.writeUInt32(key); // Flags
				buf.writeUInt8(ipbits[0]);
				buf.writeUInt8(ipbits[1]);
				buf.writeUInt8(ipbits[2]);
				buf.writeUInt8(ipbits[3]);
				buf.writeUInt16((ushort)pr.reqport);
				buf.appendBuffer(msg);
				var sendbuf = buf.getBuffer();
				this.socket.Send(sendbuf, pr.endpoint);
				this.gameInfoRequests.Remove(key);
			}
		}

		if (cmd == PacketType.MasterServerRelayRequest) {
			byte[] ipbits = [br.readU8(), br.readU8(), br.readU8(), br.readU8()];
			var port = br.readU16();
			var address = new IPAddress(ipbits);
			var connectserver = this.findServer(address, port);
			if (connectserver != null) {
				// Request a relay to give connection to this server
				// Get the relay server with lowest connections
				var pcount = number.PositiveInfinity;
				RelayServer? relay = null;
				foreach(var server in this.relayServers) {
					if (server.connected < pcount) {
						pcount = server.connected;
						relay = server;
					}
				}
				// Let the relay server know
				var myip = rinfo.Address.GetAddressBytes();
				if (relay != null) {
					var id = currentClientId++;
					this.gameRelayRequests[id] = new()
					{
						endpoint = rinfo,
						relay = relay,
						mpserver = connectserver
					};

					var buf = new BufferWriter();
					buf.writeUInt8((byte)PacketType.MasterServerRelayRequest);
					buf.writeUInt32(id);
					buf.writeUInt8(ipbits[0]); // Dest (game server)
					buf.writeUInt8(ipbits[1]);
					buf.writeUInt8(ipbits[2]);
					buf.writeUInt8(ipbits[3]);
					buf.writeUInt16((ushort)connectserver.endpoint.Port);
					buf.writeUInt8(myip[0]); // Src (us)
					buf.writeUInt8(myip[1]);
					buf.writeUInt8(myip[2]);
					buf.writeUInt8(myip[3]);
					var sendbuf = buf.getBuffer();
					this.socket.Send(sendbuf, relay.endpoint);
				}
			} else {
				var buf = new BufferWriter();
				buf.writeUInt8((byte)PacketType.MasterServerArrangedConnectionRejected);
				buf.writeUInt8(0); // Flags
				buf.writeUInt32(0); // Key
				buf.writeUInt8(0); // 0 = unknown host
				var sendbuf = buf.getBuffer();
				this.socket.Send(sendbuf, rinfo); // MasterServerRejectArrangedConnectRequest
			}
		}

		if (cmd == PacketType.MasterServerRelayResponse) {
			var id = br.readU32();
			var relayport = br.readU16();
			var relayRequest = this.gameRelayRequests.GetValueOrDefault(id);
			if (relayRequest != null) {
				var buf = new BufferWriter();
				buf.writeUInt8((byte)PacketType.MasterServerRelayResponse);
				buf.writeUInt8(0); // Key
				buf.writeUInt32(0); // Flags
				buf.writeUInt8(0); // IsHost
				var relayIpbits = relayRequest.relay.endpoint.Address.GetAddressBytes();
				buf.writeUInt8(relayIpbits[0]);
				buf.writeUInt8(relayIpbits[1]);
				buf.writeUInt8(relayIpbits[2]);
				buf.writeUInt8(relayIpbits[3]);
				buf.writeUInt16(relayport);
				var sendbuf = buf.getBuffer();
				this.socket.Send(sendbuf, relayRequest.endpoint);
				relayRequest.relay.connected++;

				// Let the host know which relay to connect to, too
				var buf2 = new BufferWriter();
				buf2.writeUInt8((byte)PacketType.MasterServerRelayResponse);
				buf2.writeUInt8(0); // Key
				buf2.writeUInt32(0); // Flags
				buf2.writeUInt8(1); // IsHost
				buf2.writeUInt8(relayIpbits[0]);
				buf2.writeUInt8(relayIpbits[1]);
				buf2.writeUInt8(relayIpbits[2]);
				buf2.writeUInt8(relayIpbits[3]);
				buf2.writeUInt16(relayport);
				var sendbuf2 = buf2.getBuffer();
				this.socket.Send(sendbuf2, relayRequest.mpserver.endpoint);

				this.gameRelayRequests.Remove(id);
			}
		}

		if (cmd == PacketType.RelayDelete) {
			var relay = this.relayServers.Find(x => x.endpoint == rinfo);
			if (relay != null) {
				Console.WriteLine($"Relay {rinfo.Address}:{rinfo.Port} disconnected by user");
				relay.connected--;
			}
		}

		if (cmd == PacketType.MasterServerJoinInvite) {
			var invite = br.readString();
			var server = this.serverList.Find(x => x.info.inviteCode == invite && x.endpoint.Address != rinfo.Address);
			if (server != null) {
				var bw = new BufferWriter();
				bw.writeUInt8((byte)PacketType.MasterServerJoinInviteResponse);
				bw.writeUInt8(0); // Key
				bw.writeUInt32(0); // Flags
				bw.writeUInt8(1); // Found
				var ipbits = server.endpoint.Address.GetAddressBytes();
				bw.writeUInt8(ipbits[0]);
				bw.writeUInt8(ipbits[1]);
				bw.writeUInt8(ipbits[2]);
				bw.writeUInt8(ipbits[3]);
				bw.writeUInt16((ushort)server.endpoint.Port);

				var sendbuf = bw.getBuffer();
				this.socket.Send(sendbuf, rinfo);
			} else {
				var bw = new BufferWriter();
				bw.writeUInt8((byte)PacketType.MasterServerJoinInviteResponse);
				bw.writeUInt8(0); // Key
				bw.writeUInt32(0); // Flags
				bw.writeUInt8(0); // Found

				var sendbuf = bw.getBuffer();
				this.socket.Send(sendbuf, rinfo);
			}
		}

		if (cmd == PacketType.RelayHeartbeat) {
			var relay = this.relayServers.Find(x => x.endpoint == rinfo);
			if (relay != null) {
				relay.timestamp = DateTime.Now;
			} else {
				// Add relay
				Console.WriteLine($"Added relay {rinfo}");
				this.relayServers.Add(new()
				{
					endpoint = rinfo,
					connected = 0,
					timestamp = DateTime.Now,
				});
			}
		}
	}
}