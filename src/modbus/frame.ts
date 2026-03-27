export const FUNCTION_CODES = Object.freeze({
  READ_HOLDING_REGISTERS: 0x03,
  READ_INPUT_REGISTERS: 0x04
});

export interface ModbusRequestFrame {
  transactionId: number;
  protocolId: number;
  length: number;
  unitId: number;
  pdu: Buffer;
}

export function extractFrames(buffer: Buffer): { frames: Buffer[]; rest: Buffer } {
  const frames: Buffer[] = [];
  let offset = 0;

  while (buffer.length - offset >= 7) {
    const length = buffer.readUInt16BE(offset + 4);
    const totalLength = 6 + length;

    if (buffer.length - offset < totalLength) {
      break;
    }

    frames.push(buffer.subarray(offset, offset + totalLength));
    offset += totalLength;
  }

  return {
    frames,
    rest: buffer.subarray(offset)
  };
}

export function parseRequestFrame(frame: Buffer): ModbusRequestFrame {
  if (frame.length < 8) {
    throw new Error('Modbus TCP frame is too short');
  }

  return {
    transactionId: frame.readUInt16BE(0),
    protocolId: frame.readUInt16BE(2),
    length: frame.readUInt16BE(4),
    unitId: frame.readUInt8(6),
    pdu: frame.subarray(7)
  };
}
