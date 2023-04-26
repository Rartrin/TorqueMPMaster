"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/mpmasterserver.ts
var udp = __toESM(require("dgram"));

// src/bufferreader.ts
var BufferReader = class {
  constructor(arrayBuffer) {
    /** The current index of reading. */
    this.index = 0;
    this.buffer = arrayBuffer;
    this.view = new DataView(arrayBuffer);
  }
  readU8() {
    return this.view.getUint8(this.index++);
  }
  readU16() {
    return this.view.getUint16((this.index = this.index + 2) - 2, true);
  }
  readU32() {
    return this.view.getUint32((this.index = this.index + 4) - 4, true);
  }
  readS8() {
    return this.view.getInt8(this.index++);
  }
  readS16() {
    return this.view.getInt16((this.index = this.index + 2) - 2, true);
  }
  readS32() {
    return this.view.getInt32((this.index = this.index + 4) - 4, true);
  }
  readF32() {
    return this.view.getFloat32((this.index = this.index + 4) - 4, true);
  }
  readString() {
    let length = this.readU8();
    let result = "";
    for (let i = 0; i < length; i++) {
      result += String.fromCharCode(this.readU8());
    }
    return result;
  }
};

// src/bufferwriter.ts
var BufferWriter = class {
  constructor() {
    this.buffers = [];
    this.offset = 0;
    this.currentBuffer = Buffer.alloc(1024);
    this.buffers.push(this.currentBuffer);
  }
  grow() {
    if (this.offset === 1024) {
      this.offset = 0;
      this.currentBuffer = Buffer.alloc(1024);
      this.buffers.push(this.currentBuffer);
    }
  }
  writeUInt8(value) {
    this.grow();
    this.currentBuffer.writeUInt8(value, this.offset);
    this.offset++;
  }
  writeUInt16(value) {
    this.grow();
    this.currentBuffer.writeUInt16LE(value, this.offset);
    this.offset += 2;
  }
  writeUInt32(value) {
    this.grow();
    this.currentBuffer.writeUInt32LE(value, this.offset);
    this.offset += 4;
  }
  getBuffer() {
    return Buffer.concat(this.buffers);
  }
};

// src/mpmasterserver.ts
var currentClientId = 0;
var MPMasterServer = class {
  constructor() {
    this.serverList = [];
    this.arrangedClients = [];
  }
  // Starts the Multiplayer Master Server
  initialize() {
    this.socket = udp.createSocket("udp4");
    this.socket.on("message", (msg, rinfo) => this.onMessage(msg, rinfo));
    this.socket.on("error", (err) => this.onError(err));
    let hostsplit = "localhost:1337".split(":");
    let hostname = hostsplit[0];
    let port = Number.parseInt(hostsplit[1]);
    this.socket.bind(port, hostname);
  }
  // Stops the server
  dispose() {
    this.socket.close();
  }
  // Received on error
  onError(err) {
    console.log(err);
  }
  // Received when someone sends a message
  onMessage(msg, rinfo) {
    let br = new BufferReader(msg.buffer);
    let cmd = br.readU8();
    console.log(`${cmd} command received`);
    if (cmd === 6 /* MasterServerListRequest */) {
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
        this.serverList.forEach((serverinfo) => {
          let serveraddress = serverinfo.address;
          let serverport = serverinfo.port;
          let now = (/* @__PURE__ */ new Date()).getTime();
          if (now > serverinfo.timestamp + 90 * 1e3) {
            this.socket.send(String.fromCharCode(10 /* GameMasterInfoRequest */), serverport, serveraddress);
          }
          let ipbits = serveraddress.split(".");
          let buf = new BufferWriter();
          buf.writeUInt8(8 /* MasterServerListResponse */);
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
        });
      } else {
        let buf = new BufferWriter();
        buf.writeUInt8(8 /* MasterServerListResponse */);
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
    if (cmd === 12 /* GameMasterInfoResponse */) {
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
      let guidList = [];
      for (let i = 0; i < playerCount; i++)
        guidList.push(br.readU32());
      let info = {
        gameType,
        missionType,
        maxPlayers,
        regionMask,
        version,
        filterFlag,
        botCount,
        cpuSpeed,
        playerCount,
        guidList
      };
      let found = false;
      for (let i = 0; i < this.serverList.length; i++) {
        if (this.serverList[i].address == rinfo.address && this.serverList[i].port == rinfo.port) {
          this.serverList[i].info = info;
          this.serverList[i].timestamp = (/* @__PURE__ */ new Date()).getTime();
          found = true;
          break;
        }
      }
      if (!found) {
        let serverInfo = {
          address: rinfo.address,
          port: rinfo.port,
          info,
          timestamp: (/* @__PURE__ */ new Date()).getTime()
        };
        this.serverList.push(serverInfo);
      }
    }
    if (cmd === 22 /* GameHeartbeat */) {
      let found = false;
      for (let i = 0; i < this.serverList.length; i++) {
        if (this.serverList[i].address == rinfo.address && this.serverList[i].port == rinfo.port) {
          this.serverList[i].timestamp = (/* @__PURE__ */ new Date()).getTime();
          found = true;
          this.socket.send(String.fromCharCode(10 /* GameMasterInfoRequest */), rinfo.port, rinfo.address);
          break;
        }
      }
      if (!found) {
        let serverInfo = {
          address: rinfo.address,
          port: rinfo.port,
          info: null,
          timestamp: (/* @__PURE__ */ new Date()).getTime()
        };
        this.socket.send(String.fromCharCode(10 /* GameMasterInfoRequest */), rinfo.port, rinfo.address);
        this.serverList.push(serverInfo);
      }
    }
    if (cmd === 46 /* MasterServerRequestArrangedConnection */) {
      let ipbits = [br.readU8(), br.readU8(), br.readU8(), br.readU8()];
      let address = `${ipbits[0]}.${ipbits[1]}.${ipbits[2]}.${ipbits[3]}`;
      let connectserver = this.serverList.find((x) => x.address === address);
      if (connectserver == null) {
        let buf = new BufferWriter();
        buf.writeUInt8(56 /* MasterServerRejectArrangedConnectResponse */);
        buf.writeUInt8(0);
        buf.writeUInt32(0);
        buf.writeUInt8(0);
        let sendbuf = buf.getBuffer();
        this.socket.send(sendbuf, rinfo.port, rinfo.address);
      } else {
        console.log(`${rinfo.address}:${rinfo.port} Requesting connection to ${connectserver.address}:${connectserver.port}`);
        let possibleAddresses = [
          {
            address: rinfo.address,
            port: rinfo.port + 1
          },
          {
            address: rinfo.address,
            port: rinfo.port
          }
        ];
        let clientid = currentClientId++;
        this.arrangedClients.push({
          address: rinfo.address,
          port: rinfo.port,
          id: clientid
        });
        let buf = new BufferWriter();
        buf.writeUInt8(48 /* MasterServerClientRequestedArrangedConnection */);
        buf.writeUInt8(0);
        buf.writeUInt32(0);
        buf.writeUInt16(clientid);
        buf.writeUInt8(possibleAddresses.length);
        for (let addr of possibleAddresses) {
          let ipbits2 = addr.address.split(".");
          buf.writeUInt8(Number.parseInt(ipbits2[0]));
          buf.writeUInt8(Number.parseInt(ipbits2[1]));
          buf.writeUInt8(Number.parseInt(ipbits2[2]));
          buf.writeUInt8(Number.parseInt(ipbits2[3]));
          buf.writeUInt16(addr.port);
        }
        let sendbuf = buf.getBuffer();
        this.socket.send(sendbuf, connectserver.port, connectserver.address);
      }
    }
    if (cmd === 50 /* MasterServerAcceptArrangedConnection */) {
      let clientId = br.readU16();
      let client = this.arrangedClients.find((x) => x.id === clientId);
      let possibleAddresses = [
        {
          address: rinfo.address,
          port: rinfo.port + 1
        },
        {
          address: rinfo.address,
          port: rinfo.port
        }
      ];
      let buf = new BufferWriter();
      buf.writeUInt8(52 /* MasterServerArrangedConnectionAccepted */);
      buf.writeUInt8(0);
      buf.writeUInt32(0);
      buf.writeUInt8(possibleAddresses.length);
      for (let addr of possibleAddresses) {
        let ipbits = addr.address.split(".");
        buf.writeUInt8(Number.parseInt(ipbits[0]));
        buf.writeUInt8(Number.parseInt(ipbits[1]));
        buf.writeUInt8(Number.parseInt(ipbits[2]));
        buf.writeUInt8(Number.parseInt(ipbits[3]));
        buf.writeUInt16(addr.port);
      }
      let sendbuf = buf.getBuffer();
      this.socket.send(sendbuf, client.port, client.address);
    }
    if (cmd === 54 /* MasterServerRejectArrangedConnectRequest */) {
    }
  }
};

// src/index.ts
console.log("Starting MP Master Server");
var server = new MPMasterServer();
server.initialize();
process.on("exit", () => {
  console.log("Stopping...");
  server.dispose();
});
process.on("SIGHUP", () => process.exit(128 + 1));
process.on("SIGINT", () => process.exit(128 + 2));
process.on("SIGTERM", () => process.exit(128 + 15));
