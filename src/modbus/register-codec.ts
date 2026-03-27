export type RegisterType = 'uint16' | 'int16' | 'uint32' | 'int32' | 'float32';

const TYPE_LENGTHS: Readonly<Record<RegisterType, 1 | 2>> = Object.freeze({
  uint16: 1,
  int16: 1,
  uint32: 2,
  int32: 2,
  float32: 2
});

function normalizeOrder(order: string | null | undefined): string {
  if (order == null) {
    return 'ABCD';
  }

  if (!/^[ABCD]{4}$/.test(order) || new Set(order).size !== 4) {
    throw new Error(`Unsupported byte order "${order}"`);
  }

  return order;
}

function restoreBytesForDecode(bytes: Buffer, order: string): Buffer {
  if (bytes.length !== 4) {
    return bytes;
  }

  const normalizedOrder = normalizeOrder(order);
  const restored = Buffer.alloc(4);

  for (let index = 0; index < normalizedOrder.length; index += 1) {
    const label = normalizedOrder[index] ?? '';
    const targetIndex = 'ABCD'.indexOf(label);
    restored[targetIndex] = bytes.readUInt8(index);
  }

  return restored;
}

export function getRegisterLength(type: RegisterType): 1 | 2 {
  return TYPE_LENGTHS[type];
}

export function decodeValue(type: RegisterType, registers: number[], order = 'ABCD'): number {
  if (registers.length !== TYPE_LENGTHS[type]) {
    throw new Error(`Expected ${TYPE_LENGTHS[type]} registers for type "${type}"`);
  }

  if (type === 'uint16') {
    return registers[0] ?? 0;
  }

  if (type === 'int16') {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16BE(registers[0] ?? 0, 0);
    return buffer.readInt16BE(0);
  }

  const buffer = Buffer.alloc(4);
  buffer.writeUInt16BE(registers[0] ?? 0, 0);
  buffer.writeUInt16BE(registers[1] ?? 0, 2);

  const restored = restoreBytesForDecode(buffer, order);

  if (type === 'uint32') {
    return restored.readUInt32BE(0);
  }

  if (type === 'int32') {
    return restored.readInt32BE(0);
  }

  return restored.readFloatBE(0);
}
