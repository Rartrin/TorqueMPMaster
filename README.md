# Torque MP Master Server
This is a Torque Multiplayer Master Server written in Typescript, along with a relay server to play multiplayer between two clients who are unable to connect to each other.

# Installation
`npm install`  
`npm run build`  

# How to run
Master Server: `node index.js`  
Relay Server: `node relay.js`

# Settings
The settings of the master and relay server are stored in settings.json file for the format:
```
{
    "masterIp": "ipAddress",
    "relayIp": "ipAddress",
    "relays" [
        "relayIp",
        ...
    ]
}
```
masterIp - The IP:port of the master server.  Required by both master and relay server.  
relayIp - The IP:port of the relay server.  Required only by the relay server.  
relays - A list of IPs:ports of relays.  Required only by the master server.