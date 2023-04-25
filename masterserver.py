import socket
import io
import struct

HOSTNAME = "127.0.0.1"
PORT = 5555

serverlist = {}

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind((HOSTNAME, PORT))

while True:
    data, addr = sock.recvfrom(1024)
    br = io.BytesIO(data)

    cmd = struct.unpack("c" ,br.read(1)) 

    if cmd == 6:
        struct.unpack("cIc")