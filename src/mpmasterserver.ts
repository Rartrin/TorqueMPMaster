import * as udp from 'dgram'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as os from 'os'
import { BufferReader } from './bufferreader';
import { BufferWriter } from './bufferwriter';

interface MPServer {
    address: string,
    port: number,
    timestamp: number
    info: {
        gameType: string,
        missionType: string,
        inviteCode: string,
        maxPlayers: number,
        regionMask: number,
        version: number,
        filterFlag: number,
        botCount: number,
        cpuSpeed: number,
        playerCount: number,
        guidList: number[]
    }
}

interface ArrangedClient {
    address: string,
    port: number,
    id: number
}

interface RelayServer {
    address: string,
    port: number,
    connected: number
}

enum PacketType {
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
}

let currentClientId = 0;

// Basically the master server for multiplayer, gives out a list of available servers to the game
export class MPMasterServer {
    socket: udp.Socket
    serverList: MPServer[] = []
    arrangedClients: ArrangedClient[] = []
    gamePingRequests: Map<number, { address: string, port: number, reqip: number[], reqport: number }> = new Map();
    gameInfoRequests: Map<number, { address: string, port: number, reqip: number[], reqport: number }> = new Map();
    gameRelayRequests: Map<number, { address: string, port: number, relay: RelayServer, mpserver: MPServer }> = new Map();
    relayServers: RelayServer[] = []
    updateInterval: ReturnType<typeof setInterval>;
    localIps: string[] = []

    // Starts the Multiplayer Master Server
    initialize() {
        this.socket = udp.createSocket('udp4')

        this.socket.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
        this.socket.on('error', (err) => this.onError(err));

        let settings = JSON.parse(fs.readFileSync('settings.json', 'utf-8'))

        for (let relayHostname of settings.relays) {
            let relayHostSplit = relayHostname.split(':');
            this.relayServers.push({
                address: relayHostSplit[0],
                port: Number.parseInt(relayHostSplit[1]),
                connected: 0
            });
        }

        let hostsplit = settings.masterIp.split(':'); // Naive but works for now
        let hostname = hostsplit[0];
        let port = Number.parseInt(hostsplit[1]);

        this.socket.bind(port, hostname);
        this.updateInterval = setInterval(() => this.update(), 60000);

        // Get our local IPs so we can resolve 127.0.0.1
        Object.keys(os.networkInterfaces()).forEach(ifname => {
            os.networkInterfaces()[ifname].forEach(iface => {
                if (iface.family === 'IPv4') {
                    this.localIps.push(iface.address);
                }
            });
        });
    }

    findServer(ip: string, port: number) {
        if (ip == "127.0.0.1") {
            for (let localip of this.localIps) {
                let s = this.serverList.find(x => x.address === localip && (port != 0 ? x.port === port : true));
                if (s != null) {
                    return s;
                }
            }
        } else {
            return this.serverList.find(x => x.address === ip && (port != 0 ? x.port === port : true));
        }
        return null;
    }

    update() {
        this.serverList = this.serverList.filter(server => {
            if (server.timestamp + 600000 < new Date().getTime()) {
                console.log(`Purging ${server.address}:${server.port} due to inactivity`);
                return false; // Purge old servers
            }
            return true;
        });
    }

    // Stops the server
    dispose() {
        this.socket.close();
    }

    // Received on error
    onError(err: Error) {
        console.log(err);
    }

    // Received when someone sends a message
    onMessage(msg: Buffer, rinfo: udp.RemoteInfo) {
        let br = new BufferReader(msg.buffer);

        let cmd = br.readU8();

        console.log(`${cmd} command received from ${rinfo.address}:${rinfo.port}`);

        if (cmd === PacketType.MasterServerListRequest) { //MasterServerListRequest

            let queryFlags = br.readU8();
            let key = br.readU32();
            let dummy = br.readU8();
            let gameType = br.readString();
            let missionType = br.readString();
            let inviteCode = br.readString();
            let minPlayers = br.readU8();
            let maxPlayers = br.readU8();
            let regionMask = br.readU32();
            let version = br.readU32();
            let filterFlag = br.readU8();
            let maxBots = br.readU8();
            let minCPU = br.readU16();
            let buddyCount = br.readU8();

            let sendServerList = this.serverList.filter(x => (x.info.filterFlag & 8) == 0); // Show only public servers

            if (sendServerList.length > 0) {
                let packettotal = sendServerList.length;
                let packetindex = 0;
                sendServerList.forEach(serverinfo => {
                    let serveraddress = serverinfo.address;
                    let serverport = serverinfo.port;

                    let now = new Date().getTime();

                    // Check for refresh
                    if (now > serverinfo.timestamp + 90 * 1000) {

                        // Check if its alive
                        let buf = new BufferWriter();
                        buf.writeUInt8(PacketType.GameMasterInfoRequest);
                        buf.writeUInt8(queryFlags);
                        buf.writeUInt32(key);
                        let sendbuf = buf.getBuffer();
                        this.socket.send(sendbuf, serverport, serveraddress); // GameMasterInfoRequest
                    }

                    let ipbits = serveraddress.split('.');

                    let isLocal = serveraddress == rinfo.address;

                    let buf = new BufferWriter();
                    buf.writeUInt8(PacketType.MasterServerListResponse); // MasterServerListResponse
                    buf.writeUInt8(isLocal ? 1 : 0); // We are using flags to let know whether the server is local or not
                    buf.writeUInt32(key);
                    buf.writeUInt8(packetindex);
                    buf.writeUInt8(packettotal);
                    buf.writeUInt16(packettotal);
                    buf.writeUInt8(Number.parseInt(ipbits[0]));
                    buf.writeUInt8(Number.parseInt(ipbits[1]));
                    buf.writeUInt8(Number.parseInt(ipbits[2]));
                    buf.writeUInt8(Number.parseInt(ipbits[3]));
                    buf.writeUInt16(serverport);

                    packetindex++;

                    let sendbuf = buf.getBuffer();

                    this.socket.send(sendbuf, rinfo.port, rinfo.address);

                })

            } else {
                let buf = new BufferWriter();
                buf.writeUInt8(PacketType.MasterServerListResponse); // MasterServerListResponse
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

                let sendbuf = buf.getBuffer();

                this.socket.send(sendbuf, rinfo.port, rinfo.address);
            }
        }

        if (cmd === PacketType.GameMasterInfoResponse) {
            let flags = br.readU8();
            let key = br.readU32();
            let gameType = br.readString();
            let missionType = br.readString();
            let inviteCode = br.readString();
            let maxPlayers = br.readU8();
            let regionMask = br.readU32();
            let version = br.readU32();
            let filterFlag = br.readU8();
            let botCount = br.readU8();
            let cpuSpeed = br.readU32();
            let playerCount = br.readU8();
            let guidList: number[] = [];
            for (let i = 0; i < playerCount; i++)
                guidList.push(br.readU32());
            
            let info = {
                        gameType: gameType,
                        missionType: missionType,
                        inviteCode: inviteCode,
                        maxPlayers: maxPlayers,
                        regionMask: regionMask,
                        version: version,
                        filterFlag: filterFlag,
                        botCount: botCount,
                        cpuSpeed: cpuSpeed,
                        playerCount: playerCount,
                        guidList: guidList
                    }

            let found = false;
            let insaddr = rinfo.address;
            if (this.localIps.includes(insaddr))
                insaddr = "127.0.0.1";
            for (let i = 0; i < this.serverList.length; i++) {
                if (this.serverList[i].address == insaddr && this.serverList[i].port == rinfo.port) {
                    this.serverList[i].info = info;
                    this.serverList[i].timestamp = new Date().getTime();
                    found = true;
                    break;
                }
            }

            if (!found) {
                let insaddr = rinfo.address;
                if (this.localIps.includes(insaddr))
                    insaddr = "127.0.0.1";
                let serverInfo: MPServer = {
                    address: insaddr,
                    port: rinfo.port,
                    info: info,
                    timestamp: new Date().getTime()
                }

                this.serverList.push(serverInfo);
            }
        }

        if (cmd === PacketType.GameHeartbeat) { // GameHeartbeat
            let found = false;
            let flags = br.readU8();
            let key = br.readU32();
            for (let i = 0; i < this.serverList.length; i++) {
                if (this.serverList[i].address == rinfo.address && this.serverList[i].port == rinfo.port) {
                    this.serverList[i].timestamp = new Date().getTime();
                    found = true;

                    // Get their info
                    let buf = new BufferWriter();
                    buf.writeUInt8(PacketType.GameMasterInfoRequest);
                    buf.writeUInt8(flags);
                    buf.writeUInt32(key);
                    let sendbuf = buf.getBuffer();
                    this.socket.send(sendbuf,  rinfo.port, rinfo.address); // GameMasterInfoRequest
                    break;
                }
            }

            if (!found) {
                let serverInfo: MPServer = {
                    address: rinfo.address,
                    port: rinfo.port,
                    info: null,
                    timestamp: new Date().getTime()
                }

                // Get their info
                let buf = new BufferWriter();
                buf.writeUInt8(PacketType.GameMasterInfoRequest);
                buf.writeUInt8(flags);
                buf.writeUInt32(key);
                let sendbuf = buf.getBuffer();
                this.socket.send(sendbuf,  rinfo.port, rinfo.address); // GameMasterInfoRequest

                this.serverList.push(serverInfo);
            }
        }

        if (cmd === PacketType.MasterServerRequestArrangedConnection) {
            let ipbits = [br.readU8(), br.readU8(), br.readU8(), br.readU8()];
            let address = `${ipbits[0]}.${ipbits[1]}.${ipbits[2]}.${ipbits[3]}`;
            let port = br.readU16();
            let connectserver = this.findServer(address, port);
            console.log(this.serverList);
            console.log(address);
            if (connectserver == null) {
                let buf = new BufferWriter();
                buf.writeUInt8(PacketType.MasterServerArrangedConnectionRejected);
                buf.writeUInt8(0); // Flags
                buf.writeUInt32(0); // Key
                buf.writeUInt8(0); // 0 = unknown host
                let sendbuf = buf.getBuffer();
                this.socket.send(sendbuf, rinfo.port, rinfo.address); // MasterServerRejectArrangedConnectRequest
            } else {
                console.log(`${rinfo.address}:${rinfo.port} Requesting connection to ${connectserver.address}:${connectserver.port}`);

                let possibleAddresses = [
                    {
                        address: rinfo.address,
                        port: rinfo.port + 1,
                    },
                    {
                        address: rinfo.address,
                        port: rinfo.port,
                    }
                ];

                let clientid = currentClientId++;

                this.arrangedClients.push({
                    address: rinfo.address,
                    port: rinfo.port,
                    id: clientid
                });
                
                let buf = new BufferWriter();
                buf.writeUInt8(PacketType.MasterServerClientRequestedArrangedConnection);
                buf.writeUInt8(0); // Flags
                buf.writeUInt32(0); // Key
                buf.writeUInt16(clientid);
                buf.writeUInt8(possibleAddresses.length);
                for (let addr of possibleAddresses) {
                    let ipbits = addr.address.split('.');
                    buf.writeUInt8(Number.parseInt(ipbits[0]));
                    buf.writeUInt8(Number.parseInt(ipbits[1]));
                    buf.writeUInt8(Number.parseInt(ipbits[2]));
                    buf.writeUInt8(Number.parseInt(ipbits[3]));
                    buf.writeUInt16(addr.port);
                }
                let sendbuf = buf.getBuffer();
                this.socket.send(sendbuf, connectserver.port, connectserver.address);
            }
        }

        if (cmd === PacketType.MasterServerAcceptArrangedConnection) {
            let clientId = br.readU16();
            let client = this.arrangedClients.find(x => x.id === clientId);
            if (client != null) {
                let possibleAddresses = [
                    {
                        address: rinfo.address,
                        port: rinfo.port + 1,
                    },
                    {
                        address: rinfo.address,
                        port: rinfo.port,
                    }
                ];

                let buf = new BufferWriter();
                buf.writeUInt8(PacketType.MasterServerArrangedConnectionAccepted);
                buf.writeUInt8(0); // Flags
                buf.writeUInt32(0); // Key
                buf.writeUInt8(possibleAddresses.length);
                for (let addr of possibleAddresses) {
                    let ipbits = addr.address.split('.');
                    buf.writeUInt8(Number.parseInt(ipbits[0]));
                    buf.writeUInt8(Number.parseInt(ipbits[1]));
                    buf.writeUInt8(Number.parseInt(ipbits[2]));
                    buf.writeUInt8(Number.parseInt(ipbits[3]));
                    buf.writeUInt16(addr.port);
                }
                let sendbuf = buf.getBuffer();
                this.socket.send(sendbuf, client.port, client.address);
            }
        }

        if (cmd === PacketType.MasterServerRejectArrangedConnection) {
            let clientId = br.readU16();
            let client = this.arrangedClients.find(x => x.id === clientId);
            if (client != null) {
                let buf = new BufferWriter();
                buf.writeUInt8(PacketType.MasterServerArrangedConnectionRejected);
                buf.writeUInt8(0); // flags
                buf.writeUInt32(0); // Key
                buf.writeUInt8(1); // 1 = Server Rejected
                let sendbuf = buf.getBuffer();
                this.socket.send(sendbuf, client.port, client.address);
            }
        }

        if (cmd === PacketType.MasterServerGamePingRequest) {
            let ipbits = [br.readU8(), br.readU8(), br.readU8(), br.readU8()];
            let port = br.readU16();
            let flags = br.readU8();
            let key = br.readU32();
            let address = `${ipbits[0]}.${ipbits[1]}.${ipbits[2]}.${ipbits[3]}`;
            let connectserver = this.findServer(address, port);
            if (connectserver != null) {
                console.log(`Pinging ${address} key ${key} ${flags}`);
                this.gamePingRequests.set(key, {
                    address: rinfo.address,
                    port: rinfo.port,
                    reqip: ipbits,
                    reqport: connectserver.port
                });
                let buf = new BufferWriter();
                buf.writeUInt8(PacketType.GamePingRequest);
                buf.writeUInt8(flags);
                buf.writeUInt32(key);
                let sendbuf = buf.getBuffer();
                this.socket.send(sendbuf, connectserver.port, connectserver.address); // We relay?
            }
        }

        if (cmd === PacketType.MasterServerGameInfoRequest) {
            let ipbits = [br.readU8(), br.readU8(), br.readU8(), br.readU8()];
            let port = br.readU16();
            let flags = br.readU8();
            let key = br.readU32();
            let address = `${ipbits[0]}.${ipbits[1]}.${ipbits[2]}.${ipbits[3]}`;
            let connectserver = this.findServer(address, port);
            if (connectserver != null) {
                console.log(`Requesting info from ${address} key ${key} ${flags}`);
                this.gameInfoRequests.set(key, {
                    address: rinfo.address,
                    port: rinfo.port,
                    reqip: ipbits,
                    reqport: connectserver.port
                });
                let buf = new BufferWriter();
                buf.writeUInt8(PacketType.GameInfoRequest);
                buf.writeUInt8(flags);
                buf.writeUInt32(key);
                let sendbuf = buf.getBuffer();
                this.socket.send(sendbuf, connectserver.port, connectserver.address); // We relay?
            }
        }

        if (cmd === PacketType.GamePingResponse) {
            let flags = br.readU8();
            let key = br.readU32();
            let pr = this.gamePingRequests.get(key);
            console.log(`Key ${key} ${flags}`);
            if (pr != null) {
                console.log(`Got ping response for ${pr.address}`);
                let buf = new BufferWriter();
                buf.writeUInt8(PacketType.MasterServerGamePingResponse);
                let ipbits = pr.reqip;
                buf.writeUInt8(flags); // Key
                buf.writeUInt32(key); // Flags
                buf.writeUInt8(ipbits[0]);
                buf.writeUInt8(ipbits[1]);
                buf.writeUInt8(ipbits[2]);
                buf.writeUInt8(ipbits[3]);
                buf.writeUInt16(pr.reqport);
                buf.appendBuffer(msg);
                let sendbuf = buf.getBuffer();
                this.socket.send(sendbuf, pr.port, pr.address);
                this.gamePingRequests.delete(key);
            }
        }

        if (cmd === PacketType.GameInfoResponse) {
            let flags = br.readU8();
            let key = br.readU32();
            let pr = this.gameInfoRequests.get(key);
            console.log(`Key ${key} ${flags}`);
            if (pr != null) {
                console.log(`Got game info response for ${pr.address}`);
                let buf = new BufferWriter();
                buf.writeUInt8(PacketType.MasterServerGameInfoResponse);
                let ipbits = pr.reqip;
                buf.writeUInt8(flags); // Key
                buf.writeUInt32(key); // Flags
                buf.writeUInt8(ipbits[0]);
                buf.writeUInt8(ipbits[1]);
                buf.writeUInt8(ipbits[2]);
                buf.writeUInt8(ipbits[3]);
                buf.writeUInt16(pr.reqport);
                buf.appendBuffer(msg);
                let sendbuf = buf.getBuffer();
                this.socket.send(sendbuf, pr.port, pr.address);
                this.gameInfoRequests.delete(key);
            }
        }

        if (cmd === PacketType.MasterServerRelayRequest) {
            let ipbits = [br.readU8(), br.readU8(), br.readU8(), br.readU8()];
            let port = br.readU16();
            let address = `${ipbits[0]}.${ipbits[1]}.${ipbits[2]}.${ipbits[3]}`;
            let connectserver = this.findServer(address, port);
            if (connectserver != null) {
                // Request a relay to give connection to this server
                // Get the relay server with lowest connections
                let pcount = Infinity;
                let relay: RelayServer = null;
                for (let server of this.relayServers) {
                    if (server.connected < pcount) {
                        pcount = server.connected;
                        relay = server;
                    }
                }
                // Let the relay server know
                let myip = rinfo.address.split(".").map(x => parseInt(x));
                if (relay != null) {
                    let id = currentClientId++;
                    this.gameRelayRequests.set(id, {
                        address: rinfo.address,
                        port: rinfo.port,
                        relay: relay,
                        mpserver: connectserver
                    })

                    let buf = new BufferWriter();
                    buf.writeUInt8(PacketType.MasterServerRelayRequest);
                    buf.writeUInt32(id);
                    buf.writeUInt8(ipbits[0]); // Dest (game server)
                    buf.writeUInt8(ipbits[1]);
                    buf.writeUInt8(ipbits[2]);
                    buf.writeUInt8(ipbits[3]);
                    buf.writeUInt16(connectserver.port);
                    buf.writeUInt8(myip[0]); // Src (us)
                    buf.writeUInt8(myip[1]);
                    buf.writeUInt8(myip[2]);
                    buf.writeUInt8(myip[3]);
                    let sendbuf = buf.getBuffer();
                    this.socket.send(sendbuf, relay.port, relay.address);
                }
            } else {
                let buf = new BufferWriter();
                buf.writeUInt8(PacketType.MasterServerArrangedConnectionRejected);
                buf.writeUInt8(0); // Flags
                buf.writeUInt32(0); // Key
                buf.writeUInt8(0); // 0 = unknown host
                let sendbuf = buf.getBuffer();
                this.socket.send(sendbuf, rinfo.port, rinfo.address); // MasterServerRejectArrangedConnectRequest
            }
        }

        if (cmd === PacketType.MasterServerRelayResponse) {
            let id = br.readU32();
            let relayport = br.readU16();
            let relayRequest = this.gameRelayRequests.get(id);
            if (relayRequest != null) {
                let buf = new BufferWriter();
                buf.writeUInt8(PacketType.MasterServerRelayResponse);
                buf.writeUInt8(0); // Key
                buf.writeUInt32(0); // Flags
                buf.writeUInt8(0); // IsHost
                let relayIpbits = relayRequest.relay.address.split(".").map(x => parseInt(x));
                buf.writeUInt8(relayIpbits[0]);
                buf.writeUInt8(relayIpbits[1]);
                buf.writeUInt8(relayIpbits[2]);
                buf.writeUInt8(relayIpbits[3]);
                buf.writeUInt16(relayport);
                let sendbuf = buf.getBuffer();
                this.socket.send(sendbuf, relayRequest.port, relayRequest.address);
                relayRequest.relay.connected++;

                // Let the host know which relay to connect to, too
                let buf2 = new BufferWriter();
                buf2.writeUInt8(PacketType.MasterServerRelayResponse);
                buf2.writeUInt8(0); // Key
                buf2.writeUInt32(0); // Flags
                buf2.writeUInt8(1); // IsHost
                buf2.writeUInt8(relayIpbits[0]);
                buf2.writeUInt8(relayIpbits[1]);
                buf2.writeUInt8(relayIpbits[2]);
                buf2.writeUInt8(relayIpbits[3]);
                buf2.writeUInt16(relayport);
                let sendbuf2 = buf2.getBuffer();
                this.socket.send(sendbuf2, relayRequest.mpserver.port, relayRequest.mpserver.address);

                this.gameRelayRequests.delete(id);
            }
        }

        if (cmd === PacketType.RelayDelete) {
            let relay = this.relayServers.find(x => x.address === rinfo.address && x.port === rinfo.port);
            if (relay != null) {
                console.log(`Relay ${rinfo.address}:${rinfo.port} disconnected by user`);
                relay.connected--;
            }
        }

        if (cmd === PacketType.MasterServerJoinInvite) {
            let invite = br.readString();
            let server = this.serverList.find(x => x.info.inviteCode == invite);
            if (server != null) {
                let bw = new BufferWriter();
                bw.writeUInt8(PacketType.MasterServerJoinInviteResponse);
                bw.writeUInt8(0); // Key
                bw.writeUInt32(0); // Flags
                bw.writeUInt8(1); // Found
                let ipbits = server.address.split(".").map(x => parseInt(x));
                bw.writeUInt8(ipbits[0]);
                bw.writeUInt8(ipbits[1]);
                bw.writeUInt8(ipbits[2]);
                bw.writeUInt8(ipbits[3]);
                bw.writeUInt16(server.port);

                let sendbuf = bw.getBuffer();
                this.socket.send(sendbuf, rinfo.port, rinfo.address);
            } else {
                let bw = new BufferWriter();
                bw.writeUInt8(PacketType.MasterServerJoinInviteResponse);
                bw.writeUInt8(0); // Key
                bw.writeUInt32(0); // Flags
                bw.writeUInt8(0); // Found

                let sendbuf = bw.getBuffer();
                this.socket.send(sendbuf, rinfo.port, rinfo.address);
            }
        }
    }
}