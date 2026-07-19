-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('OPEN', 'OUTPUT_RECORDED', 'CONFIRMED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FgStatus" AS ENUM ('GENERATED', 'READY', 'DISPATCHED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'DISPATCH';

-- AlterTable
ALTER TABLE "ProductionRequestItem" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "department" "Department" NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOutput" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "packageCount" INTEGER NOT NULL,
    "sizePerPackage" DOUBLE PRECISION NOT NULL,
    "sizeUnit" TEXT NOT NULL DEFAULT 'L',
    "productionDate" TIMESTAMP(3) NOT NULL,
    "shade" TEXT,
    "productSku" TEXT,
    "notes" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "fgGeneratedAt" TIMESTAMP(3),
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinishedGood" (
    "id" TEXT NOT NULL,
    "uniqueId" TEXT NOT NULL,
    "outputId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "sizePerPackage" DOUBLE PRECISION NOT NULL,
    "sizeUnit" TEXT NOT NULL,
    "status" "FgStatus" NOT NULL DEFAULT 'GENERATED',
    "dispatchedAt" TIMESTAMP(3),
    "dispatchedById" TEXT,
    "dispatchNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinishedGood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinishedGoodQr" (
    "id" TEXT NOT NULL,
    "finishedGoodId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "imageRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinishedGoodQr_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Batch_department_status_idx" ON "Batch"("department", "status");

-- CreateIndex
CREATE INDEX "Batch_createdAt_idx" ON "Batch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_department_batchNumber_key" ON "Batch"("department", "batchNumber");

-- CreateIndex
CREATE INDEX "ProductionOutput_batchId_idx" ON "ProductionOutput"("batchId");

-- CreateIndex
CREATE INDEX "ProductionOutput_confirmed_idx" ON "ProductionOutput"("confirmed");

-- CreateIndex
CREATE UNIQUE INDEX "FinishedGood_uniqueId_key" ON "FinishedGood"("uniqueId");

-- CreateIndex
CREATE INDEX "FinishedGood_batchId_idx" ON "FinishedGood"("batchId");

-- CreateIndex
CREATE INDEX "FinishedGood_outputId_idx" ON "FinishedGood"("outputId");

-- CreateIndex
CREATE INDEX "FinishedGood_status_idx" ON "FinishedGood"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FinishedGoodQr_finishedGoodId_key" ON "FinishedGoodQr"("finishedGoodId");

-- CreateIndex
CREATE INDEX "ProductionRequestItem_batchId_idx" ON "ProductionRequestItem"("batchId");

-- AddForeignKey
ALTER TABLE "ProductionRequestItem" ADD CONSTRAINT "ProductionRequestItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOutput" ADD CONSTRAINT "ProductionOutput_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOutput" ADD CONSTRAINT "ProductionOutput_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOutput" ADD CONSTRAINT "ProductionOutput_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGood" ADD CONSTRAINT "FinishedGood_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "ProductionOutput"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGood" ADD CONSTRAINT "FinishedGood_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGood" ADD CONSTRAINT "FinishedGood_dispatchedById_fkey" FOREIGN KEY ("dispatchedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodQr" ADD CONSTRAINT "FinishedGoodQr_finishedGoodId_fkey" FOREIGN KEY ("finishedGoodId") REFERENCES "FinishedGood"("id") ON DELETE CASCADE ON UPDATE CASCADE;
