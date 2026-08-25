-- Customer BOM intake can be transcribed directly when the customer did not
-- provide a source document. Existing uploaded-file provenance is preserved.
ALTER TABLE "customer_bom_intakes"
  ALTER COLUMN "rawFileKey" DROP NOT NULL,
  ALTER COLUMN "rawFileName" DROP NOT NULL,
  ALTER COLUMN "rawFileSize" DROP NOT NULL,
  ALTER COLUMN "rawMimeType" DROP NOT NULL;
