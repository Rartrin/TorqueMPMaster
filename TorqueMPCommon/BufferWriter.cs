namespace TorqueMPCommon;

public sealed class BufferWriter
{
	private readonly MemoryStream stream;
	private readonly BinaryWriter writer;

	public BufferWriter()
	{
		stream = new();
		writer = new(stream);
	}

	public void writeUInt8(byte value) => writer.Write(value);
	public void writeUInt16(ushort value) => writer.Write(value);
	public void writeUInt32(uint value) => writer.Write(value);

	public byte[] getBuffer() => stream.ToArray();

	public void appendBuffer(byte[] ab) => writer.Write(ab);
}