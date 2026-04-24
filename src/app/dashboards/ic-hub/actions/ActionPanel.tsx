"use client";

import type { IcActionKind } from "@/lib/pi-statuses";
import { SubmitToUtilityForm } from "./SubmitToUtilityForm";
import { ResubmitToUtilityForm } from "./ResubmitToUtilityForm";
import { ReviewRejectionForm } from "./ReviewRejectionForm";
import { CompleteRevisionForm } from "./CompleteRevisionForm";
import { ProvideInformationForm } from "./ProvideInformationForm";
import { FollowUpForm } from "./FollowUpForm";
import { MarkIcApprovedForm } from "./MarkIcApprovedForm";

export function ActionPanel({
  dealId,
  actionKind,
}: {
  dealId: string;
  actionKind: IcActionKind;
}) {
  switch (actionKind) {
    case "SUBMIT_TO_UTILITY":
      return <SubmitToUtilityForm dealId={dealId} />;
    case "RESUBMIT_TO_UTILITY":
      return <ResubmitToUtilityForm dealId={dealId} />;
    case "REVIEW_IC_REJECTION":
      return <ReviewRejectionForm dealId={dealId} />;
    case "COMPLETE_IC_REVISION":
      return <CompleteRevisionForm dealId={dealId} />;
    case "PROVIDE_INFORMATION":
      return <ProvideInformationForm dealId={dealId} />;
    case "FOLLOW_UP_UTILITY":
      return <FollowUpForm dealId={dealId} />;
    case "MARK_IC_APPROVED":
      return <MarkIcApprovedForm dealId={dealId} />;
    default:
      return (
        <div className="text-muted text-sm">No action form for this status.</div>
      );
  }
}
