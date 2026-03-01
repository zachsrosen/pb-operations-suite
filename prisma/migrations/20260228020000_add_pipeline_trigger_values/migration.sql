-- AlterEnum: add new pipeline trigger values for multi-trigger support
ALTER TYPE "BomPipelineTrigger" ADD VALUE 'WEBHOOK_READY_TO_BUILD';
ALTER TYPE "BomPipelineTrigger" ADD VALUE 'WEBHOOK_INSTALL_SCHEDULED';
