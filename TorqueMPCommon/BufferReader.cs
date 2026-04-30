using System.Text;

namespace TorqueMPCommon;

public sealed class BufferReader(byte[] buffer)
{
	private BinaryReader reader = new(new MemoryStream(buffer));

	public byte readU8() => reader.ReadByte();
	public ushort readU16() => reader.ReadUInt16();
	public uint readU32() => reader.ReadUInt32();
	public sbyte readS8() => reader.ReadSByte();
	public short readS16() => reader.ReadInt16();
	public int readS32() => reader.ReadInt32();
	public float readF32() => reader.ReadSingle();

	public string readString()
	{
		// The length of the string is given in the first byte
		byte length = reader.ReadByte();
		
		Span<byte> bytes = stackalloc byte[length];
		reader.ReadExactly(bytes);
		return Encoding.Latin1.GetString(bytes);
	}
}