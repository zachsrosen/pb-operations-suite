# Workflow progression map — status-driven cross-flow chains

**2026-06-21, from live data.** Each row is a status value that **one flow sets** and **another flow fires on** — i.e. a hand-off between workflows. This is the progression engine: how finishing one step flips a status that triggers the next. ON flows only; clones collapsed.

176 linking (property = value) hand-offs across 32 status properties.

## Design Status  (`design_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “(Archived) Revision Complete” | 12e. Design Flow - Design Revision Complete (Miscellaneous) | 12e. Design Flow - Design Revision Complete (Miscellaneous); Date Stamp \| Design Revision Complete Date |
| “(Archived) Revision In Progress” | 11e. Design Flow - Design Revision In Progress (Miscellaneous) | 06. DA Flow - In Design For Revision; 07. Inspection Flow - In Design For Revision; 11e. Design Flow - Design Revision In Progress (Miscellaneous); 12c. Design Flow - Design Revision Complete (Utility); 12e. Design Flow - Design Revision Complete (Miscellaneous) |
| “2nd Permit Revision Complete” | 12bb. Design Flow - 2nd Permit Revision Complete (AHJ) | 08b. Permit Flow - 2nd Revision Returned From Design |
| “2nd Permit Revision In Progress” | 11bb. Design Flow - 2nd Permit Revision In Progress (AHJ) | 07b. Permit Flow - In Design For Revision 2nd Time; 12bb. Design Flow - 2nd Permit Revision Complete (AHJ) |
| “2nd Revision Needed - Rejected by AHJ” | 06b. Permit Flow - 2nd Permit Rejected | Permit Revision Counter; Revision Counter |
| “2nd Utility Revision In Progress” | 11cc. Design Flow - 2nd Utility Design Revision In Progress | 12cc. Design Flow - 2nd Interconnection Revision Complete (Utility) |
| “As-Built Revision Completed” | 12d. Design Flow - As-Built Revision Complete | 08. Construction Flow - Revision Returned From Design; 08c. Permit Flow - As-Built Revision Ready to Resubmit |
| “As-Built Revision In Progress” | 11d. Design Flow - As-Built Revision In Progress | 07. Construction Flow - In Design For Revision; 07. Inspection Flow - In Design For Revision; 07c. Permit Flow - As-Built In Design For Revision; 12d. Design Flow - As-Built Revision Complete |
| “DA Revision Completed” | 12a. Design Flow - DA Revision Complete | 07. DA Flow - Revision Returned From Design |
| “DA Revision In Progress” | 11a. Design Flow - DA Revision In Progress | 06. DA Flow - In Design For Revision; 12a. Design Flow - DA Revision Complete |
| “Design Complete” | 05. Design Flow - Final Review Complete; 07. Design Flow - Stamped Plans Uploaded / Design Complete; Design Flow - D&R Design Review Complete | 01c. Permit Flow - Ready to Submit Solar App; 04. Transition \| Design & Engineering to Permitting & Interconnection; BOM Pipeline - Service Design Complete; BUS Task - Design Complete - SCE; Date Stamp \| Design Completion Date |
| “Draft Complete - Waiting on Approvals” | 03. Design Flow - Initial Review Complete; 08d. Design Flow - New Construction Design Complete; 12a. Design Flow - DA Revision Complete; 12e. Design Flow - Design Revision Complete (Miscellaneous) | 03. Design Flow - Initial Review Complete; 04. Design Flow - DA Approved / Final Design Review; Date Stamp \| Design Draft Completion Date |
| “Final Design Review” | 04. Design Flow - DA Approved / Final Design Review | Final Design Review Check |
| “IDR Revision Needed” | IDR Revision Needed | Design Flow - IDR Revision Needed; IDR Revision Counter |
| “IDR Revision in Progress” | Design Flow - IDR Revision In Progress | Design Flow - IDR Revision Complete |
| “In Progress” | 01. Design Flow - Design In Progress; Design Flow - D&R/Service Design In Progress | 01. Design Flow - Design In Progress; 02. Design Flow - Design Uploaded / Ready for Review |
| “Initial Design Review” | 02. Design Flow - Design Uploaded / Ready for Review; 11. DA Flow - Ops Communication Complete; 12a. Design Flow - DA Revision Complete; Design Flow - D&R/Service Design Uploaded | 02. Design Flow - Design Uploaded / Ready for Review; 03. Design Flow - Initial Review Complete; 08d. Design Flow - New Construction Design Complete; Design Flow - D&R Design Review Complete; Site Survey Readiness Check |
| “No Design Needed” | 01. Transition \| Closed Won to Site Survey | 04. Transition \| Design & Engineering to Permitting & Interconnection |
| “Permit Revision Completed” | 12b. Design Flow - Design Revision Complete (AHJ); 12b. Design Flow - Permit Revision Complete | 08a. Permit Flow - Revision Ready to Resubmit; Date Stamp \| Permit Revision Complete Date |
| “Permit Revision In Progress” | 11b. Design Flow - Permit Design Revision In Progress | 07a. Permit Flow - In Design For Revision; 11bb. Design Flow - 2nd Permit Revision In Progress (AHJ); 12b. Design Flow - Design Revision Complete (AHJ); 12b. Design Flow - Permit Revision Complete |
| “Ready for Design” | 03. Transition \| Site Survey to Design & Engineering; 08a. Design Flow - New Construction Design Needed | 00. Design Flow - Ready for Design; 01. Design Flow - Design In Progress |
| “Revision Needed - As-Built” | 06. Construction Flow - Design Rejected; Design Flow - As-Built Revision Needed; IDR Revision Needed | As-Built Revision Counter; Date Stamp \| Design Rejection Date; Design Flow - As-Built Revision Needed; Inspection Flow - Waiting on Permit Revisions; Revision Counter |
| “Revision Needed - DA Rejected” | 05. DA Flow - DA Rejected | 10a. Design Flow - DA Rejected; DA Revision Counter; Revision Counter |
| “Revision Needed - Rejected by AHJ” | 06a. Permit Flow - Permit Rejected | 10b. Design Flow - Design Rejected by AHJ; Date Stamp \| Design Rejection Date; Permit Revision Counter; Revision Counter |
| “Revision Needed - Rejected by Utility” | 06a. Utility Flow - Application Rejected | 10c. Design Flow - Design Rejected by Utility; Date Stamp \| Design Rejection Date; Interconnection Revision Counter; Revision Counter |
| “Submitted To Engineering” | 05. Design Flow - Final Review Complete | Date Stamp \| Date Sent to Engineering |
| “Utility Revision Completed” | 12c. Design Flow - Design Revision Complete (Utility); 12c. Design Flow - Utility Revision Complete | 08a. Utility Flow - Revision Ready to Resubmit; Date Stamp \| Utility Revision Complete Date |
| “Utility Revision In Progress” | 11c. Design Flow - Utility Revision In Progress | 07a. Utility Flow - In Design For Revision; 12c. Design Flow - Design Revision Complete (Utility); 12c. Design Flow - Utility Revision Complete |
| “Xcel - Design Needed” | 09a. Design Flow - Xcel Design Needed | 09a. Design Flow - Xcel Design Needed |
| “Xcel - In Progress” | 09b. Design Flow - Xcel Design Uploaded | 09b. Design Flow - Xcel Design Uploaded |
| “Xcel - Site Plan & SLD Completed” | 09c. Design Flow - Xcel Design Completed | 09c. Design Flow - Xcel Design Completed; Date Stamp \| Xcel Design Completion Date |

## Permitting Status  (`permitting_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “2nd Design Revision In Progress” | 07b. Permit Flow - In Design For Revision 2nd Time | 08b. Permit Flow - 2nd Revision Returned From Design |
| “2nd Revision Ready To Submit” | 08b. Permit Flow - 2nd Revision Returned From Design | 08b. Permit Flow - 2nd Revision Returned From Design; 09b. Permit Flow - Permit Resubmitted to AHJ 2nd Time |
| “As-Built Ready To Resubmit” | 08c. Permit Flow - As-Built Revision Ready to Resubmit | 08c. Permit Flow - As-Built Revision Ready to Resubmit; 09c. Permit Flow - As-Built Resubmitted to AHJ; 09c. Permit Flow - Permit Resubmitted to AHJ (As-Built) |
| “As-Built Revision In Progress” | 07c. Permit Flow - As-Built In Design For Revision | 08c. Permit Flow - As-Built Revision Ready to Resubmit |
| “As-Built Revision Needed” | 06. Construction Flow - Design Rejected | Design Flow - As-Built Revision Needed |
| “As-Built Revision Resubmitted” | 09c. Permit Flow - As-Built Resubmitted to AHJ; 09c. Permit Flow - Permit Resubmitted to AHJ (As-Built) | 09c. Permit Flow - Permit Resubmitted to AHJ (As-Built) |
| “Awaiting Utility Approval” | 04. Transition \| Design & Engineering to Permitting & Interconnection | 01b. Permit Flow - Ready for Permitting After Utility Approved; Bot Hook \| Permit Weekly Update |
| “Customer Signature Acquired” | 03. Permit Flow - Signature Retrieved From Customer | 03. Permit Flow - Signature Retrieved From Customer; Bot Hook \| Permit Weekly Update |
| “Design Revision In Progress” | 07a. Permit Flow - In Design For Revision | 08a. Permit Flow - Revision Ready to Resubmit; Bot Hook \| Permit Weekly Update |
| “Permit Issued” | Permit Flow - Payment Complete | 01. Task to Install without Xcel Approval; 02. Task to Obtain Xcel Approval; 03. New Construction Flow - Permit Issued; 05. Transition \| Permitting & Interconnection to Ready To Build or RTB - Blocked; 06. Transition \| RTB - Blocked to Ready To Build |
| “Ready For Permitting” | 01b. Permit Flow - Ready for Permitting After Utility Approved; 04. Transition \| Design & Engineering to Permitting & Interconnection; Ready for Detach & Permit \| D&R | 01a. Permit Flow - Ready for Permitting; 02a. Permit Flow - Submitted To Customer; 04. Permit Flow - Permit Submitted to AHJ; Date Stamp \| Permit Start Date |
| “Ready to Submit for SolarApp” | 00. Permit Flow - SolarApp+ Selected; 01c. Permit Flow - Ready to Submit Solar App | 01c. Permit Flow - Ready to Submit Solar App; 02b. Permit Flow - Submitted SolarApp+ |
| “Resubmitted to AHJ” | 09a. Permit Flow - Permit Resubmitted to AHJ; 09b. Permit Flow - Permit Resubmitted to AHJ 2nd Time | 05a. Permit Flow - 14 Day AHJ Follow Up; 05b. Permit Flow - 30 Day AHJ Follow Up; 05c. Permit Flow - 45 Day AHJ Follow Up; 05d. Permit Flow - 60 Day AHJ Follow Up; Bot Hook \| Permit Weekly Update |
| “Revision Ready To Resubmit” | 08a. Permit Flow - Revision Ready to Resubmit | 08a. Permit Flow - Revision Ready to Resubmit; 09a. Permit Flow - Permit Resubmitted to AHJ; Bot Hook \| Permit Weekly Update |
| “Submitted To Customer” | 02a. Permit Flow - Submitted To Customer | 02a. Permit Flow - Submitted To Customer; 03. Permit Flow - Signature Retrieved From Customer; Bot Hook \| Permit Weekly Update |
| “Submitted to AHJ” | 04. Permit Flow - Permit Submitted to AHJ | 04. Permit Flow - Permit Submitted to AHJ; 05a. Permit Flow - 14 Day AHJ Follow Up; 05b. Permit Flow - 30 Day AHJ Follow Up; 05c. Permit Flow - 45 Day AHJ Follow Up; 05d. Permit Flow - 60 Day AHJ Follow Up |

## SGIP Status  (`sgip_incentive_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “ICF Awaiting Information” | 07. SGIP Flow - ICF Waiting on Information | 07. SGIP Flow - ICF Waiting on Information; 08. SGIP Flow - ICF Information Collected by PM; Date Stamp \| Waiting on Incentive Information Date |
| “ICF Inspection Requested” | 09f. SGIP Flow - ICF Inspection Requested | 09f. SGIP Flow - ICF Inspection Requested |
| “ICF Resubmitted” | 09d. SGIP Flow - ICF Resubmitted | 09d. SGIP Flow - ICF Resubmitted |
| “ICF Sent For Signature” | 09b. SGIP Flow - ICF Sent For Signature | 09b. SGIP Flow - ICF Sent For Signature |
| “ICF Signed” | 09c. SGIP Flow - ICF Signed | 09c. SGIP Flow - ICF Signed |
| “ICF Submitted” | 09a. SGIP Flow - ICF Submitted | 09a. SGIP Flow - ICF Submitted; Date Stamp \| ICF Submit Date |
| “ICF Suspended” | 09e. SGIP Flow - ICF Suspended | 09e. SGIP Flow - ICF Suspended |
| “RRF Awaiting Information” | 02a. SGIP Flow - RRF Waiting on Information | 02a. SGIP Flow - RRF Waiting on Information; 02b. SGIP Flow - RRF Information Collected; Date Stamp \| Waiting on Incentive Information Date |
| “RRF Confirmed - Waiting on PTO” | 05. SGIP Flow - RRF Confirmed | 05. SGIP Flow - RRF Confirmed; 06. SGIP Flow - PTO Granted |
| “RRF Resubmitted” | 04e. SGIP Flow - RRF Resubmitted | 04e. SGIP Flow - RRF Resubmitted |
| “RRF Sent for Signature” | 04b. SGIP Flow - RRF Sent For Signature | 04b. SGIP Flow - RRF Sent For Signature |
| “RRF Signed” | 04c. SGIP Flow - RRF Signed | 04c. SGIP Flow - RRF Signed |
| “RRF Submitted” | 04a. SGIP Flow - RRF Submitted | 04a. SGIP Flow - RRF Submitted |
| “RRF Submitted To Waitlist” | 04d. SGIP Flow - RRF Submitted To Waitlist | 04d. SGIP Flow - RRF Submitted To Waitlist |
| “RRF Suspended” | 04f. SGIP Flow - RRF Suspended | 04f. SGIP Flow - RRF Suspended |
| “Rebate Canceled” | 10. SGIP Flow - Rebate Canceled | 10. SGIP Flow - Rebate Canceled |

## Participate Energy Status  (`participate_energy_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Contract Ready to Send” | 00. Participate Energy Flow - Waiting on Contract | 00. Participate Energy Flow - Waiting on Contract |
| “M1 Approved” | Participate Flow: M1 Approved | Participate Flow - Project Cancellation; Participate Flow: M1 Approved |
| “M1 Rejected” | Participate Flow: M1 Rejection | Participate Flow - Project Cancellation |
| “M1 Resubmitted” | Participate Flow: M1 Resubmitted; Participate Flow: M1 Resubmitted #1; Participate Flow: M1 Resubmitted #2; Participate Flow: M1 Resubmitted #3 | Participate Flow - Project Cancellation; Participate Flow: M1 Resubmitted |
| “M1 Submitted” | 04. Participate Energy Flow - M1 Submitted | 04. Participate Energy Flow - M1 Submitted; Participate Flow - Project Cancellation |
| “M2 Approved” | Participate Flow: M2 Approved | Participate Flow - Project Cancellation; Participate Flow: M2 Approved |
| “M2 Rejected” | Participate Flow: M2 Rejection | Participate Flow - Project Cancellation |
| “M2 Resubmitted” | Participate Flow: M2 Resubmitted; Participate Flow: M2 Resubmitted #1; Participate Flow: M2 Resubmitted #2; Participate Flow: M2 Resubmitted #3 | Participate Flow - Project Cancellation; Participate Flow: M2 Resubmitted |
| “M2 Submitted” | 06. Participate Energy Flow - M2 Submitted | 06. Participate Energy Flow - M2 Submitted; Participate Flow - Project Cancellation |
| “Onboarding Resubmitted” | Participate Flow: Onboarding Resubmitted | Participate Flow - Project Cancellation |
| “Ready for M1 Submission” | 03. Participate Energy Flow - Ready for M1 Submission | 03. Participate Energy Flow - Ready for M1 Submission; 04. Participate Energy Flow - M1 Submitted; Participate Flow - Project Cancellation |
| “Ready for M2 Submission” | 05. Participate Energy Flow - Ready for M2 Submission | 05. Participate Energy Flow - Ready for M2 Submission; 06. Participate Energy Flow - M2 Submitted; Participate Flow - Project Cancellation |
| “Ready for Onboarding” | PE Contract Completed | 01. Participate Energy Flow - Ready for Onboarding; Participate Flow - Project Cancellation |
| “Submitted for Onboarding” | 02. Participate Energy Flow - Onboarding Submitted | 02. Participate Energy Flow - Onboarding Submitted; Participate Flow - Project Cancellation |

## Construction Status  (`install_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Blocked” | 05. Transition \| Permitting & Interconnection to Ready To Build or RTB - Blocked | 06. Transition \| RTB - Blocked to Ready To Build; Transition from RTB to RTB - Blocked |
| “Construction Complete” | Construction Complete | 02a. 3CE EV Flow - Construction Complete; 08. Transition \| Construction to Inspections; A01. Loan Requirements Collect/Upload Task; CoA and Waivers P.E. PandaDoc Creation at CC; Create and Deliver SO Shipments |
| “In Design For Revisions” | 07. Construction Flow - In Design For Revision | 08. Construction Flow - Revision Returned From Design |
| “In Progress” | Construction Subjob In Progress | 07. Transition \| Ready To Build to Construction; Date Stamp \| Construction Start Date |
| “Loose Ends Remaining” | Construction Subjob Loose Ends Remaining | 07. Transition \| Ready To Build to Construction; 09. Construction Flow - Loose Ends Remaining |
| “On Our Way” | Construction Subjob On Our Way | 07. Transition \| Ready To Build to Construction |
| “Pending New Construction Design Review” | 01. New Construction Flow - Site Survey Complete | 02. New Construction Flow - Design Reviewed |
| “Ready to Build” | 01. Transition \| Closed Won to Site Survey; 05. Transition \| Permitting & Interconnection to Ready To Build or RTB - Blocked; 06. Transition \| RTB - Blocked to Ready To Build | 04. New Construction Flow - RTB Drone; 05. Transition \| Permitting & Interconnection to Ready To Build or RTB - Blocked; 06. Transition \| RTB - Blocked to Ready To Build; CORE Disco / Reco Needed; Construction Scheduled |
| “Scheduled” | Construction Scheduled; Construction Subjob Scheduled | 07. Transition \| Ready To Build to Construction; Construction Scheduled; Date Stamp \| Construction Booked Date |
| “Started” | Construction Subjob Started | 07. Transition \| Ready To Build to Construction |

## Interconnection Status  (`interconnection_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Application Approved” | Utility Flow - Signature Retrieved | 01b. Permit Flow - Ready for Permitting After Utility Approved; 03. PTO Flow - Ready for PTO After Utility Approved; 05. Transition \| Permitting & Interconnection to Ready To Build or RTB - Blocked; 06. Transition \| RTB - Blocked to Ready To Build; 07a. PTO Flow - Start Xcel Photos |
| “As-Built Ready to Resubmit” | 08c. Permit Flow - As-Built Revision Ready to Resubmit | Utility Flow - As-Built Resubmitted to Utility; Utiltiy Flow - As-Built Revision Ready to Resubmit |
| “Design Revision In Progress” | 07a. Utility Flow - In Design For Revision | 08a. Utility Flow - Revision Ready to Resubmit |
| “Ready To Submit” | 01. Utility Flow - Ready for Interconnection; 03a. Utility Flow - Signature Retrieved From Customer; 03b. Utility Flow - Signature Retrieved From Customer & Application Paid (Xcel); 03d. Utility Flow - Information Collected | 03. Utility Flow - Ready to Submit; 04a. Utility Flow - Submitted to Utility; Date Stamp \| Interconnection Ready To Submit Date |
| “Ready To Submit - Pending Design” | 03b. Utility Flow - Signature Retrieved From Customer & Application Paid (Xcel) | 03g. Utility Flow - Design Ready To Submit |
| “Ready for Interconnection” | 03d. Utility Flow - Information Collected; 03f. Utility Flow - Utility Bill Uploaded; 04. Transition \| Design & Engineering to Permitting & Interconnection; 05. Design Flow - Final Review Complete | 01. Utility Flow - Ready for Interconnection; 02a. Utility Flow - Submitted To Customer; 02b. Utility Flow - Submitted To Customer (Xcel); Date Stamp \| Interconnection Start Date |
| “Resubmitted To Utility” | 09a. Utility Flow - Application Resubmitted to Utility | 05a. Utility Flow - 14 Day Utility Follow Up; 05b. Utility Flow - 30 Day Utility Follow Up; 05c. Utility Flow - 45 Day Utility Follow Up; 05d. Utility Flow - 60 Day Utility Follow Up; Date Stamp \| Interconnection Resubmit Date |
| “Revision Ready To Resubmit” | 08a. Utility Flow - Revision Ready to Resubmit | 08a. Utility Flow - Revision Ready to Resubmit; 09a. Utility Flow - Application Resubmitted to Utility |
| “Submitted To Customer” | 02a. Utility Flow - Submitted To Customer; 02b. Utility Flow - Submitted To Customer (Xcel) | 02a. Utility Flow - Submitted To Customer; 02b. Utility Flow - Submitted To Customer (Xcel); 03a. Utility Flow - Signature Retrieved From Customer; 03b. Utility Flow - Signature Retrieved From Customer & Application Paid (Xcel) |
| “Submitted To Utility” | 04a. Utility Flow - Submitted to Utility | 04a. Utility Flow - Submitted to Utility; 04b. Utility Flow - Submitted To Utility (CORE); 04c. Utility Flow - Submitted To Utility (PG&E); 05a. Utility Flow - 14 Day Utility Follow Up; 05b. Utility Flow - 30 Day Utility Follow Up |

## PTO Status  (`pto_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Inspection Passed - Ready for PTO Submission” | 03. PTO Flow - Ready for PTO After Utility Approved; 05b. PTO Flow - Information Collected by PM; 07f. PTO Flow - Xcel Photos Approved; 09. Transition \| Inspections to Permission To Operate | 01. PTO Flow - Inspection Passed; 02. PTO Flow - Inspection Submitted to Utility; Date Stamp \| PTO Start Date |
| “Inspection Submitted to Utility” | 02. PTO Flow - Inspection Submitted to Utility | 02. PTO Flow - Inspection Submitted to Utility; 04a. PTO Flow - 10 Day PTO Follow-Up; 04b. PTO Flow - 30 Day PTO Follow-Up; 04c. PTO Flow - 60 Day PTO Follow-Up; Date Stamp \| PTO Submission Date |
| “Not Needed” | Interconnection Not Needed | 10. Transition \| Permission To Operate to Closeout |
| “PTO Waiting on Interconnection Approval” | 09. Transition \| Inspections to Permission To Operate; Service Flow: PTO Needed | 03. PTO Flow - Ready for PTO After Utility Approved |
| “Ready to Resubmit” | 09. PTO Flow - Ready to Resubmit | 10. PTO Flow - Ready to Resubmit |
| “Xcel Photos Ready to Resubmit” | 07d. PTO Flow - Xcel Photos Uploaded | 07e. PTO Flow - Xcel Photos Resubmitted |
| “Xcel Photos Ready to Submit” | 03. PTO Flow - Ready for PTO After Utility Approved; 07a. PTO Flow - Start Xcel Photos; 09. Transition \| Inspections to Permission To Operate | 07a. PTO Flow - Start Xcel Photos; 07b. PTO Flow - Xcel Photos Submitted |
| “Xcel Photos Resubmitted” | 07e. PTO Flow - Xcel Photos Resubmitted | 07e. PTO Flow - Xcel Photos Resubmitted; Xcel PTO Flow - Photos Follow Up |
| “Xcel Photos Submitted” | 07b. PTO Flow - Xcel Photos Submitted | Xcel PTO Flow - Photos Follow Up |

## RRF Status  (`rrf_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Awaiting Information” | 02a. SGIP Flow - RRF Waiting on Information | 02a. SGIP Flow - RRF Waiting on Information |
| “Canceled” | 10. SGIP Flow - Rebate Canceled; 11. SGIP Flow - Project Canceled | 10. SGIP Flow - Rebate Canceled |
| “Confirmed” | 05. SGIP Flow - RRF Confirmed | 05. SGIP Flow - RRF Confirmed |
| “Resubmitted” | 04e. SGIP Flow - RRF Resubmitted | 04e. SGIP Flow - RRF Resubmitted |
| “Sent For Signature” | 04b. SGIP Flow - RRF Sent For Signature | 04b. SGIP Flow - RRF Sent For Signature |
| “Signed” | 04c. SGIP Flow - RRF Signed | 04c. SGIP Flow - RRF Signed |
| “Submitted” | 04a. SGIP Flow - RRF Submitted | 04a. SGIP Flow - RRF Submitted |
| “Submitted To Waitlist” | 04d. SGIP Flow - RRF Submitted To Waitlist | 04d. SGIP Flow - RRF Submitted To Waitlist |
| “Suspended” | 04f. SGIP Flow - RRF Suspended | 04f. SGIP Flow - RRF Suspended |

## ICF Status  (`sgip_icf_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Awaiting Information” | 07. SGIP Flow - ICF Waiting on Information | 07. SGIP Flow - ICF Waiting on Information |
| “Canceled” | 10. SGIP Flow - Rebate Canceled; 11. SGIP Flow - Project Canceled | 10. SGIP Flow - Rebate Canceled |
| “Inspection Requested” | 09f. SGIP Flow - ICF Inspection Requested | 09f. SGIP Flow - ICF Inspection Requested |
| “Resubmitted” | 09d. SGIP Flow - ICF Resubmitted | 09d. SGIP Flow - ICF Resubmitted |
| “Sent for Signature” | 09b. SGIP Flow - ICF Sent For Signature | 09b. SGIP Flow - ICF Sent For Signature |
| “Signed” | 09c. SGIP Flow - ICF Signed | 09c. SGIP Flow - ICF Signed |
| “Submitted” | 09a. SGIP Flow - ICF Submitted | 09a. SGIP Flow - ICF Submitted; Date Stamp \| ICF Submit Date |
| “Suspended” | 09e. SGIP Flow - ICF Suspended | 09e. SGIP Flow - ICF Suspended |

## Design Approval Status  (`layout_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “DA Revision Ready To Send” | 07. DA Flow - Revision Returned From Design | 07. DA Flow - Revision Returned From Design |
| “Draft Complete” | 01. DA Flow - DA Ready to Send; 03. Transition \| Site Survey to Design & Engineering | 01. DA Flow - DA Ready to Send |
| “In Revision” | 06. DA Flow - In Design For Revision | 07. DA Flow - Revision Returned From Design |
| “Pending Sales Changes” | 08. Site Survey Flow - Sales Change Needed | 01c. Quality Flow - Review Needed (Sales); 08. DA Flow - Sales Change Needed |
| “Resent For Approval” | 08. DA Flow - Revised DA Sent | 03. DA Flow - DA Follow Up Task; Date Stamp \| DA Resent Date |
| “Review In Progress” | 03. Transition \| Site Survey to Design & Engineering; 09. DA Flow - Design Revision Complete; 09. DA Flow - Sales Communication Complete; 09. Site Survey Flow - Sales C/O Complete | 0. DA Flow - Ready to Review Site Survey; 01. DA Flow - DA Ready to Send |
| “Sent For Approval” | 02. DA Flow - DA Sent for Approval; PandaDoc DA Sent | 02. DA Flow - DA Sent for Approval; 03. DA Flow - DA Follow Up Task; Date Stamp \| Design Approval Sent Date |

## P.E. M1 Status  (`pe_m1_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Approved” | M1 Docs Approved; Participate Flow: M1 Approved | P.E. M1 Approved; Participate Flow: M1 Approved |
| “Onboarding Ready to Resubmit” | Participate Flow: Onboarding Ready to Resubmit | Participate Flow: Onboarding Ready to Resubmit; Participate Flow: Onboarding Resubmitted |
| “Ready for Onboarding” | 01. Participate Energy Flow - Ready for Onboarding | 01. Participate Energy Flow - Ready for Onboarding; 02. Participate Energy Flow - Onboarding Submitted |
| “Ready to Submit” | 03. Participate Energy Flow - Ready for M1 Submission | 04. Participate Energy Flow - M1 Submitted |
| “Resubmitted” | Participate Flow: M1 Resubmitted; Participate Flow: M1 Resubmitted #1; Participate Flow: M1 Resubmitted #2; Participate Flow: M1 Resubmitted #3 | Participate Flow: M1 Resubmitted |
| “Submitted” | 04. Participate Energy Flow - M1 Submitted | 04. Participate Energy Flow - M1 Submitted |

## PB Location  (`pb_location`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Camarillo” | Project Location Automation | 00. Permit Flow - SolarApp+ Selected; 05. Transition \| Permitting & Interconnection to Ready To Build or RTB - Blocked; BUS Task - Design Complete - SCE; BUS Task - Schedule back up switch appointment - Construction Complete; Marketing Email - 5-Star Review Associations (CA) |
| “Centennial” | Project Location Automation | 01. New Construction Flow - Site Survey Complete; 03. New Construction Flow - Permit Issued; 04. New Construction Flow - RTB Drone; 05. Transition \| Permitting & Interconnection to Ready To Build or RTB - Blocked; Marketing Email - 5-Star Review Associations (CO) |
| “Colorado Springs” | Project Location Automation | 01. New Construction Flow - Site Survey Complete; 03. New Construction Flow - Permit Issued; 04. New Construction Flow - RTB Drone; 05. Transition \| Permitting & Interconnection to Ready To Build or RTB - Blocked; Marketing Email - 5-Star Review Associations (CO) |
| “San Luis Obispo” | Project Location Automation | 00. Permit Flow - SolarApp+ Selected; 05. Transition \| Permitting & Interconnection to Ready To Build or RTB - Blocked; BUS Task - Design Complete - SCE; BUS Task - Schedule back up switch appointment - Construction Complete; Marketing Email - 5-Star Review Associations (CA) |
| “Westminster” | Project Location Automation | 01. New Construction Flow - Site Survey Complete; 03. New Construction Flow - Permit Issued; 04. New Construction Flow - RTB Drone; 05. Transition \| Permitting & Interconnection to Ready To Build or RTB - Blocked; Marketing Email - 5-Star Review Associations (CO) |

## 3CE Battery Status  (`n3ce_battery_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Pending Paid In Full” | 02b. 3CE Battery Flow - PTO Granted | 3CE Battery Flow - Paid in Full |
| “Ready To Submit” | 02b. 3CE Battery Flow - PTO Granted; 05b. 3CE Battery Flow - Information Collected by PM or Sales; 06b. 3CE Battery Flow - SGIP Rebate Paid; 3CE Battery Flow - Paid in Full | 02b. 3CE Battery Flow - PTO Granted; 3CE Battery Flow - Ready To Submit |
| “Submitted” | 03b. 3CE Battery Flow - Incentive Submitted | Date Stamp \| 3CE Battery Submit Date |
| “Waiting on PTO” | 01. 3CE EV & Battery Flow - Incentive Creation | 02b. 3CE Battery Flow - PTO Granted |

## P.E. M2 Status  (`pe_m2_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Approved” | M2 Docs Approved; Participate Flow: M2 Approved | P.E. M2 Approved; Participate Flow: M2 Approved |
| “Ready to Submit” | 05. Participate Energy Flow - Ready for M2 Submission | 06. Participate Energy Flow - M2 Submitted |
| “Resubmitted” | Participate Flow: M2 Resubmitted; Participate Flow: M2 Resubmitted #1; Participate Flow: M2 Resubmitted #2; Participate Flow: M2 Resubmitted #3 | Participate Flow: M2 Resubmitted |
| “Submitted” | 06. Participate Energy Flow - M2 Submitted | 06. Participate Energy Flow - M2 Submitted |

## Site Survey Status  (`site_survey_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Needs Revisit” | 08. DA Flow - Survey Revisit Needed; Design Flow - Survey Revisit Needed | 06. Site Survey Flow - Survey Revisit Needed; Create Site Survey Revisit Job |
| “Pending Loan Approval” | 01. Site Survey Flow - On Hold if Loan not Approved | 02. Site Survey Flow - Loan Approved or Cash; 03. Site Survey Flow - On Hold Loan Follow Up |
| “Ready to Schedule” | 01. Transition \| Closed Won to Site Survey; 02. Site Survey Flow - Loan Approved or Cash | 00. Site Survey Flow - Ready To Schedule; 01e. Quality Flow - Review Needed (Survey Scheduling); 05. Site Survey Flow - Survey Schedule Date |
| “Scheduled” | 05. Site Survey Flow - Survey Schedule Date | Date Stamp \| Site Survey Booked Date |

## Final Inspection Status  (`final_inspection_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Fire Inspection Scheduled” | Inspection Flow - Fire Inspection Scheduled | Inspection Flow - Fire Inspection Passed |
| “Not Needed” | Permit Not Needed | D&R - Inspection Passed or Not Needed |
| “Ready For Inspection” | 08. Inspection Flow - Permit Revision Issued; 08. Transition \| Construction to Inspections; Inspection Flow - Fire Inspection Passed | Date Stamp \| Final Inspection Start Date |
| “Waiting on Permit Revisions” | 07. Inspection Flow - In Design For Revision; Inspection Flow - Waiting on Permit Revisions | 08. Inspection Flow - Permit Revision Issued |

## 3CE EV Status  (`n3ce_ev_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Pending Paid In Full” | 02a. 3CE EV Flow - Construction Complete | 3CE EV Flow - Paid in Full |
| “Submitted” | 03a. 3CE EV Flow - Incentive Submitted | Date Stamp \| 3CE EV Submit Date |
| “Waiting on Construction Complete” | 01. 3CE EV & Battery Flow - Incentive Creation | 02a. 3CE EV Flow - Construction Complete |

## PBSR Status  (`pbsr_incentive_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Submitted” | 03. PBSR Flow - Incentive Submitted | Date Stamp \| PBSR Submit Date |
| “Waiting on PTO” | 01. PBSR Flow - Incentive Creation | 02. PBSR Flow - PTO Granted / Ready to Submit |

## Is Design Approved?  (`layout_approved`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Yes” | Date Stamp \| Design Approval Date; Design Approved | 04. Transition \| Design & Engineering to Permitting & Interconnection; Xcel Disco / Reco Needed |

## Trigger Participate Energy PandaDoc  (`trigger_participate_energy_pandadoc`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Yes” | Sales Action - No Dependent Fields | Trigger Participate Energy PandaDoc Contract Creation |

## Refresh Deal Name  (`refresh_deal_name`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Now” | Sales Action - No Dependent Fields | Deal Naming |

## Olivia Project  (`olivia_project`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Yes” | Bot Hook \| Site Survey | Bot Hook \| Closeout; Bot Hook \| Construction; Bot Hook \| Design; Bot Hook \| Inspection; Bot Hook \| Inspection Weekly Update |

## Inspection Failed Last 365 Days  (`inspection_failed_last_365_days`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Yes” | Inspection Fail (365 Days) | Inspection Fail (Not 365 Days) |

## CPA Status  (`cpa_status`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Submitted for Preapproval” | 02. CPA Flow - CPA Submitted | Date Stamp \| CPA Submit Date |

## PTO Last 365 Days  (`pto_last_365_days`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Yes” | PTO Last 365 Days | PTO First Time Pass 365 Days |

## Is Participate Energy?  (`is_participate_energy`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Yes” | Is Participate Energy? | Accounting Flow - M1 & M2 & M3 Paid; Participate Energy Removed; Share Monitoring with Participate |

## Is Construction Complete?  (`is_construction_complete_`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Yes” | Construction Complete; Date Stamp \| Construction Complete Date | SCE BUS Task - Construction Complete; Share Monitoring with Participate |

## Is Design Completed?  (`is_design_completed_`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Yes” | Date Stamp \| Design Completion Date | 04. Transition \| Design & Engineering to Permitting & Interconnection |

## Is Inspection Passed?  (`is_inspection_passed_`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Yes” | Date Stamp \| Final Inspection Pass Date; Inspection Passed | First Time Inspection Pass; First Time Inspection Pass (Not Rejected); Inspection Pass (365 Days); Service Flow: PTO Needed |

## SGIP Extension Requested?  (`sgip_extension_requested_`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Yes” | SGIP Flow - SGIP Extension Requested | SGIP Flow - SGIP Extension Requested |

## Tags  (`tags`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “SolarApp” | New Construction - Not SolarApp | 00. Permit Flow - SolarApp+ Selected; New Construction - Not SolarApp |

## Inspection Passed Last 365 Days  (`inspection_passed_last_365_days`)

| Status value | Set by (upstream flow) | → Fires (downstream flow) |
|---|---|---|
| “Yes” | Inspection Pass (365 Days) | Inspection Pass (Not 365 Days) |
