import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

export interface GstGatewayResult {
  irn?: string;
  acknowledgementNumber?: string;
  acknowledgementDate?: string;
  signedQrCode?: string;
  eWayBillNumber?: string;
  eWayBillGeneratedAt?: string;
  eWayBillValidUntil?: string;
  raw: Prisma.InputJsonObject;
}

export interface GstCancellationResult { raw: Prisma.InputJsonObject; cancelledAt?: string; }

/** Provider-neutral boundary. A GSP/IRP adapter must implement this contract. */
@Injectable()
export class GstGatewayService {
  constructor(private readonly config: ConfigService) {}

  readiness() {
    const url = this.config.get<string>('gst.gatewayUrl');
    const token = this.config.get<string>('gst.gatewayToken');
    return {
      configured: !!url && !!token,
      environment: this.config.get<string>('env') ?? 'development',
      endpointConfigured: !!url,
      credentialConfigured: !!token,
      message: url && token
        ? 'GST gateway configuration is ready for a controlled connectivity test'
        : 'GST submissions remain queued until GST_GATEWAY_URL and GST_GATEWAY_TOKEN are configured',
    };
  }

  async submit(
    documentType: string,
    payload: unknown,
    idempotencyKey: string,
  ): Promise<GstGatewayResult> {
    const url = this.config.get<string>('gst.gatewayUrl');
    const token = this.config.get<string>('gst.gatewayToken');
    if (!url || !token) {
      throw new ServiceUnavailableException(
        'GST gateway is not configured; the submission remains queued',
      );
    }
    const response = await fetch(`${url.replace(/\/$/, '')}/documents`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ documentType, payload }),
    });
    const raw = (await response.json()) as Prisma.InputJsonObject;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        String(raw.message ?? `GST gateway returned HTTP ${response.status}`),
      );
    }
    return {
      irn: raw.irn ? String(raw.irn) : undefined,
      acknowledgementNumber: raw.acknowledgementNumber
        ? String(raw.acknowledgementNumber)
        : undefined,
      acknowledgementDate: raw.acknowledgementDate
        ? String(raw.acknowledgementDate)
        : undefined,
      signedQrCode: raw.signedQrCode ? String(raw.signedQrCode) : undefined,
      eWayBillNumber: raw.eWayBillNumber
        ? String(raw.eWayBillNumber)
        : undefined,
      eWayBillGeneratedAt: raw.eWayBillGeneratedAt
        ? String(raw.eWayBillGeneratedAt)
        : undefined,
      eWayBillValidUntil: raw.eWayBillValidUntil
        ? String(raw.eWayBillValidUntil)
        : undefined,
      raw,
    };
  }

  async cancel(documentType: string, providerReference: string, reason: string, idempotencyKey: string): Promise<GstCancellationResult> {
    const url = this.config.get<string>('gst.gatewayUrl');
    const token = this.config.get<string>('gst.gatewayToken');
    if (!url || !token) throw new ServiceUnavailableException('GST gateway is not configured; cancellation was not sent');
    const response = await fetch(`${url.replace(/\/$/, '')}/documents/${encodeURIComponent(providerReference)}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey }, body: JSON.stringify({ documentType, reason }) });
    const raw = (await response.json()) as Prisma.InputJsonObject;
    if (!response.ok) throw new ServiceUnavailableException(String(raw.message ?? `GST gateway returned HTTP ${response.status}`));
    return { raw, cancelledAt: raw.cancelledAt ? String(raw.cancelledAt) : undefined };
  }
}
