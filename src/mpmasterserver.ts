import * as udp from 'dgram'
import { BufferReader } from './bufferreader';
import { BufferWriter } from './bufferwriter';

interface MPServer {
    address: string,
    port: number,
    timestamp: number
    info: {
        gameType: string,
        missionType: string,
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
}

let currentClientId = 0;

// Basically the master server for multiplayer, gives out a list of available servers to the game
export class MPMasterServer {
    socket: udp.Socket
    serverList: MPServer[] = []
    arrangedClients: ArrangedClient[] = []

    // Starts the Multiplayer Master Server
    initialize() {
        this.socket = udp.createSocket('udp4')

        this.socket.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
        this.socket.on('error', (err) => this.onError(err));

        let hostsplit = 'localhost:1337'.split(':'); // Naive but works for now
        let hostname = hostsplit[0];
        let port = Number.parseInt(hostsplit[1]);

        this.socket.bind(port, hostname);
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

        console.log(`${cmd} command received`);

        if (cmd === PacketType.MasterServerListRequest) { //MasterServerListRequest

            let queryFlags = br.readU8();
            let key = br.readU32();
            let dummy = br.readU8();
            let gameType = br.readString();
            let missionType = br.readString();
            let minPlayers = br.readU8();
            let maxPlayers = br.readU8();
            let regionMask = br.readU32();
            let version = br.readU32();
            let filterFlag = br.readU8();
            let maxBots = br.readU8();
            let minCPU = br.readU16();
            let buddyCount = br.readU8();

            if (this.serverList.length > 0) {
                let packettotal = this.serverList.length;
                let packetindex = 0;
                this.serverList.forEach(serverinfo => {
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

                    let buf = new BufferWriter();
                    buf.writeUInt8(PacketType.MasterServerListResponse); // MasterServerListResponse
                    buf.writeUInt8(0);
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
            for (let i = 0; i < this.serverList.length; i++) {
                if (this.serverList[i].address == rinfo.address && this.serverList[i].port == rinfo.port) {
                    this.serverList[i].info = info;
                    this.serverList[i].timestamp = new Date().getTime();
                    found = true;
                    break;
                }
            }

            if (!found) {
                let serverInfo: MPServer = {
                    address: rinfo.address,
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
            let connectserver = this.serverList.find(x => x.address === address);
            if (connectserver == null) {
                let buf = new BufferWriter();
                buf.writeUInt8(PacketType.MasterServerArrangedConnectionRejected);
                buf.writeUInt8(0); // Key
                buf.writeUInt32(0); // Flags
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
                buf.writeUInt8(0); // Key
                buf.writeUInt32(0); // Flags
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
                buf.writeUInt8(0); // Key
                buf.writeUInt32(0); // Flags
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
                buf.writeUInt8(0); // Key
                buf.writeUInt32(0); // Flags
                buf.writeUInt8(1); // 1 = Server Rejected
                let sendbuf = buf.getBuffer();
                this.socket.send(sendbuf, client.port, client.address);
            }
        }
    }
}