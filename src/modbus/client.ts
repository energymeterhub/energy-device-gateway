import net from 'node:net';
import { decodeValue, getRegisterLength, type RegisterType } from './register-codec.js';
import { extractFrames, FUNCTION_CODES, parseRequestFrame } from './frame.js';

export interface ModbusTcpClientOptions {
  host: string;
  port: number;
  unitId?: number;
  timeoutMs?: number;
}

export interface ReadValueOptions {
  bank: 'holding' | 'input';
  address: number;
  type: RegisterType;
  order?: string;
}

export class ModbusClientError extends Error {}

export class ModbusExceptionError extends ModbusClientError {
  readonly functionCode: number;
  readonly exceptionCode: number;

  constructor(functionCode: number, exceptionCode: number) {
    super(
      `Modbus exception response for function 0x${functionCode.toString(16)}: code 0x${exceptionCode.toString(16)}`
    );
    this.name = 'ModbusExceptionError';
    this.functionCode = functionCode;
    this.exceptionCode = exceptionCode;
  }
}

export class ModbusTcpClient {
  private readonly host: string;
  private readonly port: number;
  private readonly unitId: number;
  private readonly timeoutMs: number;
  private transactionId = 1;

  constructor(options: ModbusTcpClientOptions) {
    this.host = options.host;
    this.port = options.port;
    this.unitId = options.unitId ?? 1;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  private nextTransactionId(): number {
    const current = this.transactionId;
    this.transactionId = this.transactionId >= 0xffff ? 1 : this.transactionId + 1;
    return current;
  }

  private buildRequest(functionCode: number, payload: Buffer): Buffer {
    const transactionId = this.nextTransactionId();
    const pdu = Buffer.concat([Buffer.from([functionCode]), payload]);
    const frame = Buffer.alloc(7 + pdu.length);

    frame.writeUInt16BE(transactionId, 0);
    frame.writeUInt16BE(0, 2);
    frame.writeUInt16BE(pdu.length + 1, 4);
    frame.writeUInt8(this.unitId, 6);
    pdu.copy(frame, 7);

    return frame;
  }

  private async request(functionCode: number, payload: Buffer): Promise<Buffer> {
    const requestFrame = this.buildRequest(functionCode, payload);

    return new Promise<Buffer>((resolve, reject) => {
      const socket = net.connect({
        host: this.host,
        port: this.port
      });

      let pending = Buffer.alloc(0);
      let settled = false;

      const settle = (callback: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        callback();
      };

      const timeout = setTimeout(() => {
        settle(() => {
          reject(new ModbusClientError(`Modbus request timed out after ${this.timeoutMs}ms`));
        });
      }, this.timeoutMs);

      socket.on('connect', () => {
        socket.write(requestFrame);
      });

      socket.on('data', (chunk) => {
        pending = Buffer.concat([pending, Buffer.from(chunk)]);
        const { frames } = extractFrames(pending);

        if (frames.length === 0) {
          return;
        }

        settle(() => {
          try {
            const responseFrame = parseRequestFrame(frames[0]!);

            if (responseFrame.protocolId !== 0) {
              throw new ModbusClientError('Unexpected Modbus protocol id in response');
            }

            if (responseFrame.unitId !== this.unitId) {
              throw new ModbusClientError(`Unexpected unit id ${responseFrame.unitId} in response`);
            }

            const responseFunctionCode = responseFrame.pdu.readUInt8(0);
            const responsePayload = responseFrame.pdu.subarray(1);

            if (responseFunctionCode === (functionCode | 0x80)) {
              throw new ModbusExceptionError(functionCode, responsePayload.readUInt8(0) ?? 0);
            }

            if (responseFunctionCode !== functionCode) {
              throw new ModbusClientError(
                `Unexpected function code 0x${responseFunctionCode.toString(16)}`
              );
            }

            resolve(responsePayload);
          } catch (error) {
            reject(error);
          }
        });
      });

      socket.on('error', (error) => {
        settle(() => reject(error));
      });
    });
  }

  async readRegisters(bank: 'holding' | 'input', startAddress: number, quantity: number): Promise<number[]> {
    if (!Number.isInteger(startAddress) || startAddress < 0) {
      throw new ModbusClientError('startAddress must be a non-negative integer');
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 125) {
      throw new ModbusClientError('quantity must be an integer between 1 and 125');
    }

    const payload = Buffer.alloc(4);
    payload.writeUInt16BE(startAddress, 0);
    payload.writeUInt16BE(quantity, 2);

    const functionCode =
      bank === 'holding'
        ? FUNCTION_CODES.READ_HOLDING_REGISTERS
        : FUNCTION_CODES.READ_INPUT_REGISTERS;

    const responsePayload = await this.request(functionCode, payload);
    const byteCount = responsePayload.readUInt8(0);

    if (byteCount !== quantity * 2 || responsePayload.length !== byteCount + 1) {
      throw new ModbusClientError('Malformed Modbus read response payload');
    }

    const values: number[] = [];
    for (let index = 0; index < quantity; index += 1) {
      values.push(responsePayload.readUInt16BE(1 + index * 2));
    }

    return values;
  }

  async readValue(options: ReadValueOptions): Promise<number> {
    const quantity = getRegisterLength(options.type);
    const values = await this.readRegisters(options.bank, options.address, quantity);
    return decodeValue(options.type, values, options.order);
  }
}
