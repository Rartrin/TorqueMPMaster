import * as udp from 'dgram'
import * as fs from 'fs-extra'
import * as path from 'path'
import { BufferReader } from './bufferreader';
import { BufferWriter } from './bufferwriter';

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
}

interface RelayInfo {
    socket: udp.Socket,
    srcIp: string,
    srcPort?: number,
    destIp: string,
    destPort: number,
    lastUpdated: number
}

let currentClientId = 0;

// Basically the master server for multiplayer, gives out a list of available servers to the game
export class MPRelayServer {
    socket: udp.Socket
    relays: RelayInfo[] = [];
    updateInterval: ReturnType<typeof setInterval>;
    masterServerAddress: string;
    masterServerPort: number;

    // Starts the Multiplayer Master Server
    initialize() {
        this.socket = udp.createSocket('udp4')

        let settings = JSON.parse(fs.readFileSync('settings.json', 'utf-8'))

        let mastersplit = settings.masterIp.split(':'); // Naive but works for now
        this.masterServerAddress = mastersplit[0];
        this.masterServerPort = Number.parseInt(mastersplit[1]);

        this.socket.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
        this.socket.on('error', (err) => this.onError(err));

        let hostsplit = settings.relayIp.split(':'); // Naive but works for now
        let hostname = hostsplit[0];
        let port = Number.parseInt(hostsplit[1]);

        this.socket.bind(port, hostname);
        this.updateInterval = setInterval(() => this.update(), 10000);
    }

    update() {
        this.relays = this.relays.filter(server => {
            if (server.lastUpdated + 10000 < new Date().getTime()) {
                console.log(`Purging ${server.srcIp}:${server.srcPort} <--> ${server.destIp}:${server.destPort} due to inactivity`);
                server.socket.close(); // Close the socket
                // Send the signal back to master server that the relay has been deleted
                let bw = new BufferWriter();
                bw.writeUInt8(PacketType.RelayDelete);
                let sendbuf = bw.getBuffer();
                this.socket.send(sendbuf, this.masterServerPort, this.masterServerAddress);
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

        if (cmd === PacketType.MasterServerRelayRequest) {
            let id = br.readU32();
            let targetIp = [br.readU8(), br.readU8(), br.readU8(), br.readU8()];
            let targetPort = br.readU16();
            let srcIp = [br.readU8(), br.readU8(), br.readU8(), br.readU8()];
            let relay = this.createRelay(`${srcIp[0]}.${srcIp[1]}.${srcIp[2]}.${srcIp[3]}`, `${targetIp[0]}.${targetIp[1]}.${targetIp[2]}.${targetIp[3]}`, targetPort,
                (relay) => {
                let bw = new BufferWriter();
                bw.writeUInt8(PacketType.MasterServerRelayResponse);
                bw.writeUInt32(id);
                let relayPort = relay.socket.address().port;
                bw.writeUInt16(relayPort);
                let sendbuf = bw.getBuffer();
                this.socket.send(sendbuf, rinfo.port, rinfo.address); // Reply with the relay port
            });
        }
    }

    createRelay(srcIp: string, targetIp: string, targetPort: number, callback: (relay: RelayInfo) => void) {
        let relay = this.relays.find(x => x.srcIp === srcIp && x.destIp === targetIp && x.destPort === targetPort);

        if (!relay) {
            console.log(`Creating relay from ${srcIp} to ${targetIp}:${targetPort}`);
            relay = {
                socket: udp.createSocket('udp4'),
                srcIp: srcIp,
                destIp: targetIp,
                destPort: targetPort,
                lastUpdated: Date.now()
            };

            relay.socket.on('message', (msg, rinfo) => this.onRelayMessage(msg, rinfo, relay));
            relay.socket.on('error', (err) => this.onRelayError(err, relay!));
            relay.socket.bind(0, '0.0.0.0', () => callback(relay));
            this.relays.push(relay);
        }

        relay.lastUpdated = Date.now();
        return relay;
    }

    onRelayError(err: Error, relay: RelayInfo) {
        console.log(err);
        relay.socket.close();
        this.relays.splice(this.relays.indexOf(relay), 1);
    }

    onRelayMessage(msg: Buffer, rinfo: udp.RemoteInfo, relay: RelayInfo) {
        relay.lastUpdated = Date.now();
        if (rinfo.address == relay.srcIp && rinfo.port != relay.destPort) {
            relay.srcPort = rinfo.port; // Update the source port for when we send the packet back
            relay.socket.send(msg, relay.destPort, relay.destIp);
        } else { // Relay back to the source IP
            relay.socket.send(msg, relay.srcPort, relay.srcIp);
        }
    }
}