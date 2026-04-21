-- Add HubSpot `layout_status` (DA workflow state) to the IDR meeting item snapshot.
ALTER TABLE "IdrMeetingItem" ADD COLUMN "designApprovalStatus" TEXT;
