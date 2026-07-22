-- AlterTable
ALTER TABLE "suppliers" ALTER COLUMN "registeredAddress" DROP NOT NULL,
ALTER COLUMN "factoryAddress" DROP NOT NULL,
ALTER COLUMN "yearEstablished" DROP NOT NULL,
ALTER COLUMN "numberOfEmployees" DROP NOT NULL,
ALTER COLUMN "annualTurnover" DROP NOT NULL,
ALTER COLUMN "contactPersonName" DROP NOT NULL,
ALTER COLUMN "contactPersonDesignation" DROP NOT NULL,
ALTER COLUMN "contactPhone" DROP NOT NULL;

-- AlterTable
ALTER TABLE "vendors" ALTER COLUMN "registeredAddress" DROP NOT NULL,
ALTER COLUMN "factoryAddress" DROP NOT NULL,
ALTER COLUMN "yearEstablished" DROP NOT NULL,
ALTER COLUMN "numberOfEmployees" DROP NOT NULL,
ALTER COLUMN "annualTurnover" DROP NOT NULL,
ALTER COLUMN "contactPersonName" DROP NOT NULL,
ALTER COLUMN "contactPersonDesignation" DROP NOT NULL,
ALTER COLUMN "contactPhone" DROP NOT NULL;
