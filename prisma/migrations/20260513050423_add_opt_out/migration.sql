-- CreateTable
CREATE TABLE "opt_out" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opt_out_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opt_out_phone_organization_id_key" ON "opt_out"("phone", "organization_id");

-- AddForeignKey
ALTER TABLE "opt_out" ADD CONSTRAINT "opt_out_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
