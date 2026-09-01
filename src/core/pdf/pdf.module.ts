import { Global, Module } from '@nestjs/common';
import { PdfService } from './pdf.service';

/**
 * Global for the same reason EmailModule is: there is exactly one HTML → PDF
 * renderer in this system, and any feature module that produces an outward-facing
 * document should inject it rather than talk to Gotenberg itself.
 */
@Global()
@Module({
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
