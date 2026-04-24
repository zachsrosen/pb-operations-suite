"use client";

import type { PermitActionKind } from "@/lib/pi-statuses";
import { SubmitToAhjForm } from "./SubmitToAhjForm";
import { ResubmitToAhjForm } from "./ResubmitToAhjForm";
import { ReviewRejectionForm } from "./ReviewRejectionForm";
import { FollowUpForm } from "./FollowUpForm";
import { CompleteRevisionForm } from "./CompleteRevisionForm";
import { StartAsBuiltRevisionForm } from "./StartAsBuiltRevisionForm";
import { CompleteAsBuiltForm } from "./CompleteAsBuiltForm";
import { SubmitSolarAppForm } from "./SubmitSolarAppForm";
import { MarkPermitIssuedForm } from "./MarkPermitIssuedForm";

export function ActionPanel({
  dealId,
  actionKind,
}: {
  dealId: string;
  actionKind: PermitActionKind;
}) {
  switch (actionKind) {
    case "SUBMIT_TO_AHJ":
      return <SubmitToAhjForm dealId={dealId} />;
    case "RESUBMIT_TO_AHJ":
      return <ResubmitToAhjForm dealId={dealId} />;
    case "REVIEW_REJECTION":
      return <ReviewRejectionForm dealId={dealId} />;
    case "FOLLOW_UP":
      return <FollowUpForm dealId={dealId} />;
    case "COMPLETE_REVISION":
      return <CompleteRevisionForm dealId={dealId} />;
    case "START_AS_BUILT_REVISION":
      return <StartAsBuiltRevisionForm dealId={dealId} />;
    case "COMPLETE_AS_BUILT":
      return <CompleteAsBuiltForm dealId={dealId} />;
    case "SUBMIT_SOLARAPP":
      return <SubmitSolarAppForm dealId={dealId} />;
    case "MARK_PERMIT_ISSUED":
      return <MarkPermitIssuedForm dealId={dealId} />;
    default:
      return (
        <div className="text-muted text-sm">No action form for this status.</div>
      );
  }
}
