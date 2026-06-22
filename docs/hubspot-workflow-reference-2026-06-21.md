# PB HubSpot Workflow Reference (DRAFT — generated from live Automation v4 API)

> **Generated 2026-06-21** from `GET /automation/v4/flows`. 933 live flows; **736 enabled (🟢)**, **197 disabled (⚪)**.
> Machine-generated draft to refresh the SOP *Workflows* tab. Review with Zach before publishing.

Legend: 🟢 enabled · ⚪ disabled.

## Lead Routing & Assignments (Owner/Lead — WMS)  (12 flows · 6 on / 6 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| 🟢 | `1719101199` | Deal | Assignments \| D&R Team |
| 🟢 | `1672538946` | Deal | Assignments \| Loan Lead |
| 🟢 | `236469530` | Deal | Assignments \| Project Manager |
| 🟢 | `229154643` | Deal | Assignments \| Project Team |
| 🟢 | `1615315307` | Deal | Design Compliance Letter Task - Arapahoe - WMS |
| ⚪ | `1619463181` | Deal | Design Lead - Design Approved - WMS |
| 🟢 | `1615315268` | Deal | PM Arapahoe Compliance Letter Task - WMS |
| ⚪ | `1612729166` | Deal | Precon Lead - Application Approved - WMS |
| ⚪ | `1613617710` | Deal | Precon Lead - Permit Issued - WMS |
| ⚪ | `1678616604` | Deal | Precon Lead - PTO Granted |
| ⚪ | `1678688558` | Deal | Precon Lead - Xcel Photos Approved |
| ⚪ | `1691802513` | Deal | Precon Lead - Xcel Photos Rejected |

## 01 · Site Survey Flow  (14 flows · 11 on / 3 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| 🟢 | `1688138303` | Deal | 00. Site Survey Flow - Ready To Schedule |
| 🟢 | `1676100722` | Deal | 01. New Construction Flow - Site Survey Complete |
| 🟢 | `1669815382` | Deal | 01. Site Survey Flow - On Hold if Loan not Approved |
| 🟢 | `1669826699` | Deal | 02. Site Survey Flow - Loan Approved or Cash |
| 🟢 | `1669815398` | Deal | 03. Site Survey Flow - On Hold Loan Follow Up |
| ⚪ | `616759368` | Deal | 04. Site Survey Flow - DA Review Task |
| ⚪ | `1680289369` | Deal | 04. Site Survey Flow - Survey Scheduled |
| 🟢 | `1681041302` | Deal | 05. Site Survey Flow - Survey Schedule Date |
| 🟢 | `1688137564` | Deal | 06. Site Survey Flow - Survey Revisit Needed |
| 🟢 | `1695844132` | Deal | 07. Site Survey Flow - Day of Survey Upload |
| 🟢 | `1727496061` | Deal | 08. Site Survey Flow - Sales Change Needed |
| 🟢 | `1727479446` | Deal | 09. Site Survey Flow - Sales C/O Complete |
| 🟢 | `236999060` | Deal | PM Notification \| Site Survey Completed |
| ⚪ | `1838744462` | Deal | Site Survey Flow - Revisit Needed |

## 02 · Quality Flow (90-day stuck review)  (7 flows · 5 on / 2 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| ⚪ | `1675191675` | Deal | 01. Quality Flow - Review Needed |
| 🟢 | `1675386525` | Deal | 01b. Quality Flow - Review Needed (Site Survey) |
| 🟢 | `1675395601` | Deal | 01c. Quality Flow - Review Needed (Sales)  |
| 🟢 | `1676083640` | Deal | 01d. Quality Flow - Review Needed (90 Days) |
| 🟢 | `1676151201` | Deal | 01e. Quality Flow - Review Needed (Survey Scheduling) |
| ⚪ | `1676151203` | Deal | 01e. Quality Flow - Review Needed (Survey Scheduling) (cloned) |
| 🟢 | `1676114754` | Deal | 02. Quality Flow - Review Completed |

## 03 · Design Flow  (79 flows · 67 on / 12 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| ⚪ | `452278033` | Deal | (Turned Off) Design Flow - Design Revision Ready For Stamping |
| ⚪ | `452276369` | Deal | (Turned Off) Design Flow - Design Revision Returned From Designers |
| 🟢 | `1821167945` | Deal | 00. Design Flow - Ready for Design |
| 🟢 | `451529604` | Deal | 01. Design Flow - Design In Progress |
| 🟢 | `451596390` | Deal | 02. Design Flow - Design Uploaded / Ready for Review |
| 🟢 | `451531891` | Deal | 03. Design Flow - Initial Review Complete |
| 🟢 | `451609218` | Deal | 04. Design Flow - DA Approved / Final Design Review |
| 🟢 | `452235785` | Deal | 05. Design Flow - Final Review Complete |
| 🟢 | `615798055` | Deal | 06. Design Flow - Design Stamps in Progress |
| 🟢 | `615789852` | Deal | 07. Design Flow - Stamped Plans Uploaded / Design Complete |
| 🟢 | `1669562280` | Deal | 08a. Design Flow - New Construction Design Needed |
| ⚪ | `1669561013` | Deal | 08b. Design Flow - New Construction Design In Progress |
| ⚪ | `1669594212` | Deal | 08c. Design Flow - New Construction Design Uploaded |
| 🟢 | `1674143797` | Deal | 08d. Design Flow - New Construction Design Complete |
| 🟢 | `612458001` | Deal | 09a. Design Flow - Xcel Design Needed |
| 🟢 | `1603257463` | Deal | 09b. Design Flow - Xcel Design Uploaded |
| 🟢 | `1617500296` | Deal | 09c. Design Flow - Xcel Design Completed |
| 🟢 | `1628122414` | Deal | 10a. Design Flow - DA Rejected  |
| ⚪ | `1628122429` | Deal | 10b. Design Flow - Design Rejected by AHJ |
| 🟢 | `1692909615` | Deal | 10b. Design Flow - Design Rejected by AHJ |
| ⚪ | `1669697055` | Deal | 10bb. Design Flow - Design Rejected by AHJ 2nd Time |
| 🟢 | `1628139182` | Deal | 10c. Design Flow - Design Rejected by Utility |
| ⚪ | `1669725348` | Deal | 10cc. Design Flow - 2nd Design Rejected by Utility |
| ⚪ | `1689344865` | Deal | 10e. Design Flow - Design Revision Needed (Miscellaneous) |
| 🟢 | `452276354` | Deal | 11a. Design Flow - DA Revision In Progress (#1) |
| 🟢 | `1693017175` | Deal | 11a. Design Flow - DA Revision In Progress (#2) |
| 🟢 | `1693914156` | Deal | 11a. Design Flow - DA Revision In Progress (#3) |
| 🟢 | `1628179810` | Deal | 11b. Design Flow - Permit Design Revision In Progress |
| 🟢 | `1692909623` | Deal | 11b. Design Flow - Permit Design Revision In Progress (#1) |
| 🟢 | `1692907909` | Deal | 11b. Design Flow - Permit Design Revision In Progress (#2) |
| 🟢 | `1693525823` | Deal | 11b. Design Flow - Permit Design Revision In Progress (#3) |
| 🟢 | `1719133603` | Deal | 11b. Design Flow - Permit Design Revision In Progress (#4) |
| 🟢 | `1669704097` | Deal | 11bb. Design Flow - 2nd Permit Revision In Progress (AHJ) |
| ⚪ | `1628196128` | Deal | 11c. Design Flow - Design Revision In Progress (Util) |
| 🟢 | `1692906131` | Deal | 11c. Design Flow - Utility Revision In Progress (#1) |
| 🟢 | `1692918369` | Deal | 11c. Design Flow - Utility Revision In Progress (#2) |
| 🟢 | `1693527729` | Deal | 11c. Design Flow - Utility Revision In Progress (#3) |
| 🟢 | `1669725342` | Deal | 11cc. Design Flow - 2nd Utility Design Revision In Progress |
| ⚪ | `1692839312` | Deal | 11d. Design Flow - As-Built Design Revision In Progress |
| 🟢 | `1628180838` | Deal | 11d. Design Flow - As-Built Revision In Progress |
| 🟢 | `1692857509` | Deal | 11d. Design Flow - As-Built Revision In Progress (#1) |
| 🟢 | `1692789855` | Deal | 11d. Design Flow - As-Built Revision In Progress (#2) |
| 🟢 | `1692876613` | Deal | 11d. Design Flow - As-Built Revision In Progress (#3) |
| 🟢 | `1738637680` | Deal | 11d. Design Flow - As-Built Revision In Progress (#4) |
| 🟢 | `1689332772` | Deal | 11e. Design Flow - Design Revision In Progress (Miscellaneous) |
| 🟢 | `452288545` | Deal | 12a. Design Flow - DA Revision Complete (#1) |
| 🟢 | `1693012513` | Deal | 12a. Design Flow - DA Revision Complete (#2) |
| 🟢 | `1693911669` | Deal | 12a. Design Flow - DA Revision Complete (#3) |
| 🟢 | `1628179986` | Deal | 12b. Design Flow - Design Revision Complete (AHJ) |
| 🟢 | `1692908961` | Deal | 12b. Design Flow - Permit Revision Complete (#1) |
| 🟢 | `1692915626` | Deal | 12b. Design Flow - Permit Revision Complete (#2) |
| 🟢 | `1693525820` | Deal | 12b. Design Flow - Permit Revision Complete (#3) |
| 🟢 | `1719133602` | Deal | 12b. Design Flow - Permit Revision Complete (#4) |
| 🟢 | `1683133023` | Deal | 12bb. Design Flow - 2nd Permit Revision Complete (AHJ) |
| 🟢 | `1628179990` | Deal | 12c. Design Flow - Design Revision Complete (Utility) |
| 🟢 | `1692918336` | Deal | 12c. Design Flow - Utility Revision Complete (#1) |
| 🟢 | `1692906153` | Deal | 12c. Design Flow - Utility Revision Complete (#2) |
| 🟢 | `1693500485` | Deal | 12c. Design Flow - Utility Revision Complete (#3) |
| 🟢 | `1683139940` | Deal | 12cc. Design Flow - 2nd Interconnection Revision Complete (Utility) |
| ⚪ | `1628181106` | Deal | 12d. Design Flow - As-Built Revision Complete |
| 🟢 | `1692857519` | Deal | 12d. Design Flow - As-Built Revision Complete (#1) |
| 🟢 | `1692875328` | Deal | 12d. Design Flow - As-Built Revision Complete (#2) |
| 🟢 | `1692875355` | Deal | 12d. Design Flow - As-Built Revision Complete (#3) |
| 🟢 | `1738657704` | Deal | 12d. Design Flow - As-Built Revision Complete (#4) |
| 🟢 | `1689347381` | Deal | 12e. Design Flow - Design Revision Complete (Miscellaneous) |
| 🟢 | `452203632` | Deal | Design Flow - As-Built Revision Needed |
| 🟢 | `1689120051` | Deal | Design Flow - D&R Design Review Complete |
| 🟢 | `1683705649` | Deal | Design Flow - D&R/Service Design In Progress |
| 🟢 | `1683704366` | Deal | Design Flow - D&R/Service Design Needed |
| 🟢 | `1683704374` | Deal | Design Flow - D&R/Service Design Uploaded |
| 🟢 | `1820367966` | Deal | Design Flow - IDR Revision Complete (#1)  |
| 🟢 | `1820413984` | Deal | Design Flow - IDR Revision In Progress (#1) |
| 🟢 | `1820376181` | Deal | Design Flow - IDR Revision Needed |
| 🟢 | `559307102` | Deal | Design Flow - Project Complete |
| 🟢 | `1839342095` | Deal | Design Flow - Survey Revisit Needed |
| ⚪ | `1839342774` | Deal | Design Flow: Download TrueDesign Files |
| 🟢 | `1839427868` | Deal | Design Flow: Eagleview Failed |
| 🟢 | `1839313190` | Deal | Design Flow: Eagleview Ready for Review |
| 🟢 | `1839313718` | Deal | Design Flow: Eagleview Reviewed |

## 04 · DA Flow (Design Approval)  (27 flows · 24 on / 3 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| 🟢 | `1745625237` | Deal | 0. DA Flow - Ready to Review Site Survey |
| ⚪ | `1837115932` | Deal | 0. DA Flow - Review Layout for DA |
| 🟢 | `451524935` | Deal | 01. DA Flow - DA Ready to Send |
| 🟢 | `451599947` | Deal | 02. DA Flow - DA Sent for Approval |
| 🟢 | `1652590083` | Deal | 03. DA Flow - DA Follow Up Task |
| ⚪ | `1669000230` | Deal | 04. DA Flow - DA Approved & Ready To Upload |
| 🟢 | `1612991778` | Deal | 05. DA Flow - DA Rejected |
| 🟢 | `1612987504` | Deal | 06. DA Flow - In Design For Revision |
| 🟢 | `1612991810` | Deal | 07. DA Flow - Revision Returned From Design |
| 🟢 | `1739534928` | Deal | 08. DA Flow - Design Change Needed |
| 🟢 | `1678739082` | Deal | 08. DA Flow - Revised DA Sent (#1) |
| 🟢 | `1704884010` | Deal | 08. DA Flow - Revised DA Sent (#2) |
| 🟢 | `1704873137` | Deal | 08. DA Flow - Revised DA Sent (#3) |
| 🟢 | `1677135967` | Deal | 08. DA Flow - Sales Change Needed |
| 🟢 | `1838744842` | Deal | 08. DA Flow - Survey Revisit Needed |
| 🟢 | `1739490591` | Deal | 09. DA Flow - Design Revision Complete |
| 🟢 | `1677102085` | Deal | 09. DA Flow - Sales Communication Complete |
| 🟢 | `1677196982` | Deal | 10. DA Flow - Ops/Survey Change Needed |
| 🟢 | `1677171461` | Deal | 11. DA Flow - Ops Communication Complete |
| ⚪ | `1670705044` | Deal | DA Flow - Copy of DA Sent Date from Date Entered D&E Stage |
| 🟢 | `1838848150` | Deal | DA Flow - Send DA Reminder |
| 🟢 | `367655021` | Deal | Date Stamp \| Design Approval Date |
| 🟢 | `367569684` | Deal | Date Stamp \| Design Approval Rejection Date |
| 🟢 | `367568503` | Deal | Date Stamp \| Design Approval Sent Date |
| 🟢 | `367653727` | Deal | Date Stamp \| Design Approval Start Date |
| 🟢 | `1705123420` | Deal | Design Approved |
| 🟢 | `1704991789` | Deal | PandaDoc DA Sent |

## 05 · Permit Flow  (44 flows · 44 on / 0 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| 🟢 | `1675381665` | Deal | 00. Permit Flow - SolarApp+ Selected |
| 🟢 | `452253474` | Deal | 01a. Permit Flow - Ready for Permitting |
| 🟢 | `1654394964` | Deal | 01b. Permit Flow - Ready for Permitting After Utility Approved |
| 🟢 | `1607314506` | Deal | 01c. Permit Flow - Ready to Submit Solar App |
| 🟢 | `452288647` | Deal | 02a. Permit Flow - Submitted To Customer |
| 🟢 | `1671936563` | Deal | 02b. Permit Flow - Submitted SolarApp+ |
| 🟢 | `1677488812` | Deal | 03. New Construction Flow - Permit Issued |
| 🟢 | `452364081` | Deal | 03. Permit Flow - Signature Retrieved From Customer |
| 🟢 | `452373303` | Deal | 04. Permit Flow - Permit Submitted to AHJ |
| 🟢 | `1660431753` | Deal | 05a. Permit Flow - 14 Day AHJ Follow Up |
| 🟢 | `452281883` | Deal | 05b. Permit Flow - 30 Day AHJ Follow Up |
| 🟢 | `454682435` | Deal | 05c. Permit Flow - 45 Day AHJ Follow Up |
| 🟢 | `454599522` | Deal | 05d. Permit Flow - 60 Day AHJ Follow Up |
| 🟢 | `452309080` | Deal | 06a. Permit Flow - Permit Rejected |
| 🟢 | `1669696925` | Deal | 06b. Permit Flow - 2nd Permit Rejected |
| 🟢 | `452377159` | Deal | 07a. Permit Flow - In Design For Revision |
| 🟢 | `1669725225` | Deal | 07b. Permit Flow - In Design For Revision 2nd Time |
| 🟢 | `1682945355` | Deal | 07c. Permit Flow - As-Built In Design For Revision |
| 🟢 | `454614958` | Deal | 08a. Permit Flow - Revision Ready to Resubmit |
| 🟢 | `1669697075` | Deal | 08b. Permit Flow - 2nd Revision Returned From Design |
| 🟢 | `1683112738` | Deal | 08c. Permit Flow - As-Built Revision Ready to Resubmit |
| 🟢 | `454682439` | Deal | 09a. Permit Flow - Permit Resubmitted to AHJ |
| 🟢 | `1693500322` | Deal | 09a. Permit Flow - Permit Resubmitted to AHJ (#1) |
| 🟢 | `1693525787` | Deal | 09a. Permit Flow - Permit Resubmitted to AHJ (#2) |
| 🟢 | `1693454599` | Deal | 09a. Permit Flow - Permit Resubmitted to AHJ (#3) |
| 🟢 | `1669725237` | Deal | 09b. Permit Flow - Permit Resubmitted to AHJ 2nd Time |
| 🟢 | `1693462881` | Deal | 09c. Permit Flow - As-Built Resubmitted to AHJ (#1) |
| 🟢 | `1693462884` | Deal | 09c. Permit Flow - As-Built Resubmitted to AHJ (#2) |
| 🟢 | `1693501474` | Deal | 09c. Permit Flow - As-Built Resubmitted to AHJ (#3) |
| 🟢 | `1675071040` | Deal | 09c. Permit Flow - Permit Resubmitted to AHJ (As-Built) |
| 🟢 | `1668248461` | Deal | 10a. Permit Flow - Permit Expiration in 30 Days |
| 🟢 | `1668247816` | Deal | 10b. Permit Flow - Permit Expiration in 14 days |
| 🟢 | `1671877970` | Deal | 12. Permit Flow - Project Canceled |
| 🟢 | `1803426732` | Deal | Associated AHJ is SolarApp+ or Symbium |
| 🟢 | `1838844770` | Deal | EV ESA Permit Issued |
| 🟢 | `1821764096` | Deal | New Construction - Not SolarApp |
| 🟢 | `1779126355` | Deal | Permit Flow - Payment Complete |
| 🟢 | `1779075222` | Deal | Permit Flow - Pending Payment |
| 🟢 | `1838848395` | Deal | Permit Flow: Data Input |
| 🟢 | `1702257187` | Deal | Permit Issued |
| 🟢 | `1699754551` | Deal | Permit Issued Last 365 Days |
| 🟢 | `1698533257` | Deal | Permit Issued Last 90 Days |
| 🟢 | `1699754548` | Deal | Permit Issued Not Last 365 Days |
| 🟢 | `1698532677` | Deal | Permit Issued Not Last 90 Days |

## 06 · Utility / Interconnection Flow  (88 flows · 74 on / 14 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| ⚪ | `1677079405` | Deal | 00. Utility Flow - Deal Association |
| 🟢 | `1669726792` | Deal | 01. Task to Install without Xcel Approval |
| 🟢 | `454656155` | Deal | 01. Utility Flow - Ready for Interconnection |
| ⚪ | `1663518220` | Deal | 01. Utility Flow - Ready for Interconnection (PG&E & SCE) |
| ⚪ | `1663535428` | Deal | 01. Utility Flow - Ready for Interconnection (SCE) |
| ⚪ | `1662589725` | Deal | 01. Utility Flow - Ready for Interconnection (Xcel) |
| 🟢 | `1838781095` | Deal | 02. Task to Obtain Xcel Approval |
| 🟢 | `454682456` | Deal | 02a. Utility Flow - Submitted To Customer |
| 🟢 | `1662592929` | Deal | 02b. Utility Flow - Submitted To Customer (Xcel) |
| 🟢 | `1680722258` | Deal | 03. Utility Flow - Ready to Submit |
| 🟢 | `454599543` | Deal | 03a. Utility Flow - Signature Retrieved From Customer |
| 🟢 | `1662592953` | Deal | 03b. Utility Flow - Signature Retrieved From Customer & Application Paid (Xcel) |
| 🟢 | `473087049` | Deal | 03c. Utility Flow - Waiting on Information |
| 🟢 | `472985991` | Deal | 03d. Utility Flow - Information Collected (#1) |
| 🟢 | `1696553295` | Deal | 03d. Utility Flow - Information Collected (#2) |
| 🟢 | `1696574905` | Deal | 03d. Utility Flow - Information Collected (#3) |
| 🟢 | `1661943895` | Deal | 03e. Utility Flow - Waiting on Utility Bill |
| 🟢 | `1660408344` | Deal | 03f. Utility Flow - Utility Bill Uploaded (#1) |
| 🟢 | `1696574897` | Deal | 03f. Utility Flow - Utility Bill Uploaded (#2) |
| 🟢 | `1696524041` | Deal | 03f. Utility Flow - Utility Bill Uploaded (#3) |
| 🟢 | `1681388134` | Deal | 03g. Utility Flow - Design Ready To Submit |
| 🟢 | `367568166` | Deal | 04. Transition \| Design & Engineering to Permitting & Interconnection |
| 🟢 | `454615064` | Deal | 04a. Utility Flow - Submitted to Utility |
| 🟢 | `1665609308` | Deal | 04b. Utility Flow - Submitted To Utility (CORE) |
| 🟢 | `1663518317` | Deal | 04c. Utility Flow - Submitted To Utility (PG&E) |
| ⚪ | `1663518320` | Deal | 04d. Utility Flow - Submitted To Utility (SCE) |
| 🟢 | `367654578` | Deal | 05. Transition \| Permitting & Interconnection to Ready To Build or RTB - Blocked |
| 🟢 | `1660431927` | Deal | 05a. Utility Flow - 14 Day Utility Follow Up |
| 🟢 | `454601497` | Deal | 05b. Utility Flow - 30 Day Utility Follow Up |
| 🟢 | `454601500` | Deal | 05c. Utility Flow - 45 Day Utility Follow Up |
| 🟢 | `454640538` | Deal | 05d. Utility Flow - 60 Day Utility Follow Up |
| 🟢 | `1693399573` | Deal | 05e. Utility Flow - Supplemental Review Follow Up |
| 🟢 | `454653567` | Deal | 06a. Utility Flow - Application Rejected |
| ⚪ | `1669703050` | Deal | 06b. Utility Flow - 2nd Application Rejected |
| 🟢 | `1674645591` | Deal | 07a. PTO Flow - Start Xcel Photos |
| 🟢 | `454615687` | Deal | 07a. Utility Flow - In Design For Revision |
| 🟢 | `1674645611` | Deal | 07b. PTO Flow - Xcel Photos Submitted |
| ⚪ | `1669725303` | Deal | 07b. Utility Flow - In Design For Revision 2nd Time |
| 🟢 | `1668280358` | Deal | 07c. PTO Flow - Xcel Photos Rejected |
| 🟢 | `1674643123` | Deal | 07d. PTO Flow - Xcel Photos Uploaded |
| 🟢 | `1739428162` | Deal | 07d. PTO Flow - Xcel Photos Uploaded (#1) |
| 🟢 | `1739203438` | Deal | 07d. PTO Flow - Xcel Photos Uploaded (#2) |
| 🟢 | `1739428168` | Deal | 07d. PTO Flow - Xcel Photos Uploaded (#3) |
| 🟢 | `1674650238` | Deal | 07e. PTO Flow - Xcel Photos Resubmitted |
| 🟢 | `1739428173` | Deal | 07e. PTO Flow - Xcel Photos Resubmitted (#1) |
| 🟢 | `1739490564` | Deal | 07e. PTO Flow - Xcel Photos Resubmitted (#2) |
| 🟢 | `1739534916` | Deal | 07e. PTO Flow - Xcel Photos Resubmitted (#3) |
| 🟢 | `1674980959` | Deal | 07f. PTO Flow - Xcel Photos Approved |
| 🟢 | `454654887` | Deal | 08a. Utility Flow - Revision Ready to Resubmit |
| ⚪ | `1669725361` | Deal | 08b. Utility Flow - 2nd Revision Ready to Resubmit |
| 🟢 | `454693248` | Deal | 09a. Utility Flow - Application Resubmitted to Utility |
| 🟢 | `1693459484` | Deal | 09a. Utility Flow - Application Resubmitted to Utility (#1) |
| 🟢 | `1693525804` | Deal | 09a. Utility Flow - Application Resubmitted to Utility (#2) |
| 🟢 | `1693459487` | Deal | 09a. Utility Flow - Application Resubmitted to Utility (#3) |
| ⚪ | `1669724003` | Deal | 09b. Utility Flow - 2nd Application Resubmitted to Utility |
| 🟢 | `1663526823` | Deal | 10a. Utility Flow - Pending Customer Signature (PG&E) |
| ⚪ | `1663526830` | Deal | 10b. Utility Flow - Rejected Pending Signature (SCE) |
| 🟢 | `1671886761` | Deal | 11. Utility Flow - Project Canceled |
| 🟢 | `1675050800` | Deal | 12a. Utility Flow - Upload Transformer Upgrade Review |
| 🟢 | `1675070894` | Deal | 12b. Utility Flow - Review Transformer Upgrade Review |
| 🟢 | `367675792` | Deal | Date Stamp \| Interconnection Approval Date |
| 🟢 | `1692622517` | Deal | Date Stamp \| Interconnection Ready To Submit Date |
| 🟢 | `367687452` | Deal | Date Stamp \| Interconnection Rejection Date |
| 🟢 | `367676089` | Deal | Date Stamp \| Interconnection Resubmit Date |
| 🟢 | `367676162` | Deal | Date Stamp \| Interconnection Start Date |
| 🟢 | `367676760` | Deal | Date Stamp \| Interconnection Submit Date |
| 🟢 | `1674130956` | Deal | Date Stamp \| Xcel Design Completion Date |
| ⚪ | `1662602289` | Deal | Incentive Creation (Xcel) |
| 🟢 | `1702282806` | Deal | Interconnection Approved |
| 🟢 | `1698605604` | Deal | Interconnection Approved Last 90 Days |
| 🟢 | `1698615552` | Deal | Interconnection Approved Not Last 90 Days |
| ⚪ | `1662589961` | Deal | Interconnection for New Construction |
| 🟢 | `1652022082` | Deal | Interconnection Not Needed |
| 🟢 | `1692341067` | Deal | Interconnection Revision Counter |
| 🟢 | `1696110180` | Deal | Interconnection Revision Counter Value Set |
| 🟢 | `1695040929` | Deal | Is Xcel Battery Rebate? |
| 🟢 | `1840159412` | Deal | Participate Flow: Internal Rejection for Interconnection |
| 🟢 | `1802843523` | Deal | Participate Flow: M2 Rejection for Interconnection |
| ⚪ | `1726401714` | Deal | Submit Xcel PTO Photos at Inspection |
| 🟢 | `1700058787` | Deal | Utility Flow - Approved; Pending Signatures |
| 🟢 | `1778367524` | Deal | Utility Flow - As-Built Resubmitted to Utility |
| 🟢 | `1700079745` | Deal | Utility Flow - Signature Retrieved (#1) |
| 🟢 | `1726537273` | Deal | Utility Flow - Signature Retrieved (#2) |
| 🟢 | `1726594072` | Deal | Utility Flow - Signature Retrieved (#3) |
| 🟢 | `1838778968` | Deal | Utility Flow - Waiting on PE |
| 🟢 | `1823568454` | Deal | Xcel Disco / Reco Needed |
| 🟢 | `1693399584` | Deal | Xcel PTO Flow - Photos Follow Up |
| ⚪ | `613337108` | Deal | Xcel SLD and Site Plan Complete. |

## 07 · PTO Flow  (36 flows · 31 on / 5 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| 🟢 | `472337462` | Deal | 01. PTO Flow - Inspection Passed |
| 🟢 | `1666488687` | Deal | 02. PBSR Flow - PTO Granted / Ready to Submit |
| 🟢 | `472293655` | Deal | 02. PTO Flow - Inspection Submitted to Utility |
| 🟢 | `1666162351` | Deal | 02b. 3CE Battery Flow - PTO Granted |
| 🟢 | `1663227710` | Deal | 03. PTO Flow - Ready for PTO After Utility Approved |
| 🟢 | `1663842225` | Deal | 04a. PTO Flow - 10 Day PTO Follow-Up |
| 🟢 | `472332146` | Deal | 04b. PTO Flow - 30 Day PTO Follow-Up |
| 🟢 | `472289193` | Deal | 04c. PTO Flow - 60 Day PTO Follow-Up |
| 🟢 | `1663235353` | Deal | 05a. PTO Flow - Waiting on Information |
| 🟢 | `1663235151` | Deal | 05b. PTO Flow - Information Collected by PM |
| 🟢 | `1668248882` | Deal | 06. PTO Flow - PTO Submission Rejected |
| 🟢 | `1667609509` | Deal | 06. SGIP Flow - PTO Granted |
| 🟢 | `1675070992` | Deal | 08. PTO Flow - Ops Related Rejection |
| 🟢 | `1824107345` | Deal | 09. PTO Flow - Ready to Resubmit |
| 🟢 | `367568199` | Deal | 09. Transition \| Inspections to Permission To Operate |
| 🟢 | `1824042850` | Deal | 10. PTO Flow - Ready to Resubmit |
| 🟢 | `374096962` | Deal | 10. Transition \| Permission To Operate to Closeout |
| 🟢 | `1670515274` | Deal | Bot Hook \| PTO |
| 🟢 | `367790473` | Deal | Date Stamp \| PTO Granted Date |
| 🟢 | `367733269` | Deal | Date Stamp \| PTO Rejection Date |
| 🟢 | `1670181660` | Deal | Date Stamp \| PTO Resubmission Date |
| 🟢 | `1675390326` | Deal | Date Stamp \| PTO Start Date |
| 🟢 | `367733772` | Deal | Date Stamp \| PTO Submission Date |
| ⚪ | `1664648878` | Deal | Incentive Flow - PTO Granted |
| ⚪ | `1664648981` | Deal | Incentive Flow - PTO Received - Ready to Submit |
| 🟢 | `1630525009` | Deal | Incentives PTO Notification |
| ⚪ | `603121969` | Deal | PM Email - Phase 6: Inspection to PTO |
| ⚪ | `603103773` | Deal | PM Email - Phase 7: PTO to Closeout |
| 🟢 | `1691810448` | Deal | PRECON & PM - PTO Pending Truck Roll |
| 🟢 | `1717260698` | Deal | PTO Fail 365 Days |
| 🟢 | `1717240382` | Deal | PTO First Time Pass 365 Days |
| ⚪ | `1704992838` | Deal | PTO Granted |
| 🟢 | `1839342343` | Deal | PTO Invoice Paid |
| 🟢 | `1715823425` | Deal | PTO Last 365 Days |
| 🟢 | `1715877387` | Deal | PTO Not Last 365 Days |
| 🟢 | `1840159577` | Deal | Service Flow: PTO Needed |

## 08 · Inspection Flow  (9 flows · 6 on / 3 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| ⚪ | `605606021` | Deal | 06. Inspection Flow - Rejected |
| 🟢 | `605567402` | Deal | 07. Inspection Flow - In Design For Revision |
| 🟢 | `1720282240` | Deal | 08. Inspection Flow - Permit Revision Issued |
| ⚪ | `605605644` | Deal | 08. Inspection Flow - Revision Returned From Design |
| 🟢 | `1667318308` | Deal | 09. Inspection Flow - Inspection Failed |
| ⚪ | `419615822` | Deal | Arrivy Inspection Transition |
| 🟢 | `1823568440` | Deal | Inspection Flow - Fire Inspection Passed |
| 🟢 | `1823567734` | Deal | Inspection Flow - Fire Inspection Scheduled |
| 🟢 | `1806719316` | Deal | Inspection Flow - Waiting on Permit Revisions |

## 09 · Transition (stage transitions)  (9 flows · 6 on / 3 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| ⚪ | `1756200563` | Deal | -01. Transition \| Proposal Accepted to Closed Won |
| 🟢 | `367635755` | Deal | 01. Transition \| Closed Won to Site Survey |
| ⚪ | `1677928834` | Deal | 02. Transition \| Site Survey to Project Rejected |
| 🟢 | `367644234` | Deal | 03. Transition \| Site Survey to Design & Engineering |
| ⚪ | `367644937` | Deal | 03. Transition \| Site Survey to Design & Engineering |
| 🟢 | `607298219` | Deal | 06. Transition \| RTB - Blocked to Ready To Build |
| 🟢 | `367565967` | Deal | 07. Transition \| Ready To Build to Construction |
| 🟢 | `367565974` | Deal | 08. Transition \| Construction to Inspections |
| 🟢 | `374096964` | Deal | 11. Transition \| Closeout to Completion |

## Participate Energy (PE) Flow  (37 flows · 30 on / 7 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| ⚪ | `1775948453` | Deal | Participate Flow - Design Ready To Upload |
| 🟢 | `1808167597` | Deal | Participate Flow - Project Cancellation |
| 🟢 | `1840159507` | Deal | Participate Flow: Internal Rejection for Accounting |
| 🟢 | `1840159511` | Deal | Participate Flow: Internal Rejection for Compliance |
| 🟢 | `1840110101` | Deal | Participate Flow: Internal Rejection for Design |
| 🟢 | `1840110103` | Deal | Participate Flow: Internal Rejection for Ops |
| 🟢 | `1840159508` | Deal | Participate Flow: Internal Rejection for Permitting |
| 🟢 | `1840159499` | Deal | Participate Flow: Internal Rejection for Sales |
| 🟢 | `1798912273` | Deal | Participate Flow: M1 Approved |
| 🟢 | `1775922803` | Deal | Participate Flow: M1 Ready to Resubmit |
| ⚪ | `1809923253` | Deal | Participate Flow: M1 Ready to Resubmit #1 |
| ⚪ | `1809926913` | Deal | Participate Flow: M1 Ready to Resubmit #2 |
| ⚪ | `1809956468` | Deal | Participate Flow: M1 Ready to Resubmit #3 |
| 🟢 | `1775948197` | Deal | Participate Flow: M1 Rejection |
| 🟢 | `1802817374` | Deal | Participate Flow: M1 Rejection for Accounting |
| 🟢 | `1840159844` | Deal | Participate Flow: M1 Rejection for Compliance |
| 🟢 | `1802842973` | Deal | Participate Flow: M1 Rejection for Design |
| 🟢 | `1802817367` | Deal | Participate Flow: M1 Rejection for Ops |
| 🟢 | `1802894915` | Deal | Participate Flow: M1 Rejection for Permitting |
| 🟢 | `1802892582` | Deal | Participate Flow: M1 Rejection for Sales |
| 🟢 | `1776024736` | Deal | Participate Flow: M1 Resubmitted |
| 🟢 | `1810039431` | Deal | Participate Flow: M1 Resubmitted #1 |
| 🟢 | `1810038612` | Deal | Participate Flow: M1 Resubmitted #2 |
| 🟢 | `1809958470` | Deal | Participate Flow: M1 Resubmitted #3 |
| 🟢 | `1798909584` | Deal | Participate Flow: M2 Approved |
| 🟢 | `1776024697` | Deal | Participate Flow: M2 Ready to Resubmit |
| ⚪ | `1809963701` | Deal | Participate Flow: M2 Ready to Resubmit #1 |
| ⚪ | `1810038606` | Deal | Participate Flow: M2 Ready to Resubmit #2 |
| ⚪ | `1809959791` | Deal | Participate Flow: M2 Ready to Resubmit #3 |
| 🟢 | `1776024081` | Deal | Participate Flow: M2 Rejection |
| 🟢 | `1776024754` | Deal | Participate Flow: M2 Resubmitted |
| 🟢 | `1810039153` | Deal | Participate Flow: M2 Resubmitted #1 |
| 🟢 | `1809956475` | Deal | Participate Flow: M2 Resubmitted #2 |
| 🟢 | `1809963797` | Deal | Participate Flow: M2 Resubmitted #3 |
| 🟢 | `1775922812` | Deal | Participate Flow: Onboarding Ready to Resubmit |
| 🟢 | `1766480231` | Deal | Participate Flow: Onboarding Rejection |
| 🟢 | `1776025435` | Deal | Participate Flow: Onboarding Resubmitted |

## SGIP Flow (CA storage incentive)  (18 flows · 16 on / 2 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| 🟢 | `1667309186` | Deal | SGIP Flow - Copy of Expiry Date 1 |
| 🟢 | `1667304733` | Deal | SGIP Flow - Copy of Expiry Date 2 |
| 🟢 | `1667309207` | Deal | SGIP Flow - Copy of Expiry Date 3 |
| 🟢 | `1667298830` | Deal | SGIP Flow - Copy of ICF Approval Date |
| 🟢 | `1667292185` | Deal | SGIP Flow - Copy of ICF Paid Date |
| 🟢 | `1667304553` | Deal | SGIP Flow - Copy of ICF Rejection Date |
| 🟢 | `1667321380` | Deal | SGIP Flow - Copy of ICF Status |
| 🟢 | `1667295403` | Deal | SGIP Flow - Copy of ICF Submit Date |
| 🟢 | `1667304794` | Deal | SGIP Flow - Copy of Incentive Amount |
| 🟢 | `1667304764` | Deal | SGIP Flow - Copy of Reservation Expiry Date |
| 🟢 | `1667305108` | Deal | SGIP Flow - Copy of RRF Status |
| ⚪ | `1666163035` | Deal | SGIP Flow - Copy of RRF Submit Date |
| 🟢 | `1667500630` | Deal | SGIP Flow - Copy of SGIP App Type |
| 🟢 | `1667307599` | Deal | SGIP Flow - Copy of TSLA Received Date |
| 🟢 | `1667306274` | Deal | SGIP Flow - Copy of TSLA Request Date |
| ⚪ | `1667368518` | Deal | SGIP Flow - RRF Confirmed |
| 🟢 | `1667788857` | Deal | SGIP Flow - SGIP Extension Requested |
| 🟢 | `616130429` | Deal | SGIP Plan Match Confirmation \| SLO |

## Incentive Flow  (19 flows · 12 on / 7 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| 🟢 | `1662579858` | Deal | 01. 3CE EV & Battery Flow - Incentive Creation |
| 🟢 | `1662581400` | Deal | 01. CPA Flow - Incentive Creation |
| ⚪ | `1670279308` | Deal | 01. Incentive Flow - Information Collected by PM or Deal Owner |
| 🟢 | `1662581382` | Deal | 01. PBSR Flow - Incentive Creation |
| 🟢 | `1662579843` | Deal | 01. SGIP Flow - Incentive Creation |
| 🟢 | `1665904953` | Deal | 03. PBSR Flow - Incentive Submitted |
| 🟢 | `1666161157` | Deal | 03a. 3CE EV Flow - Incentive Submitted |
| 🟢 | `1666161057` | Deal | 03b. 3CE Battery Flow - Incentive Submitted |
| ⚪ | `1665856689` | Deal | 3CE Flow - Incentive Submitted |
| 🟢 | `1667254297` | Deal | Date Stamp \| Waiting on Incentive Information Date  |
| ⚪ | `251373165` | Deal | Incentive Creation |
| 🟢 | `1662598679` | Deal | Incentive Creation (Denver Cares) |
| 🟢 | `1662581392` | Deal | Incentive Creation (Fort Collins) |
| ⚪ | `1664693011` | Deal | Incentive Flow - Construction Complete |
| ⚪ | `1665876275` | Deal | Incentive Flow - Incentive Submit Date |
| ⚪ | `1665867631` | Deal | Incentive Flow - Incentive Submitted |
| ⚪ | `1665840494` | Deal | Incentive Flow - Incentive(s) Selected |
| 🟢 | `1664315766` | Deal | Incentive Flow - Information Collected |
| 🟢 | `1664323638` | Deal | Incentive Flow - Waiting on Information |

## Production Guarantee / Service Warranty  (3 flows · 2 on / 1 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| 🟢 | `1628410720` | Deal | 1 Year Production Guarantee Check |
| 🟢 | `1628408614` | Deal | 180 Day Production Guarantee Check |
| ⚪ | `1628403234` | Deal | 30 Day Production Guarantee Check |

## Date Stamp | (system date stamping)  (42 flows · 35 on / 7 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| 🟢 | `1666151310` | Deal | Date Stamp \| 3CE Battery Submit Date |
| 🟢 | `1666163003` | Deal | Date Stamp \| 3CE EV Submit Date |
| 🟢 | `1700067713` | Deal | Date Stamp \| Construction Booked Date |
| 🟢 | `367733173` | Deal | Date Stamp \| Construction Complete Date |
| 🟢 | `367733425` | Deal | Date Stamp \| Construction Start Date |
| 🟢 | `1667274145` | Deal | Date Stamp \| CPA Submit Date |
| ⚪ | `1722374474` | Deal | Date Stamp \| Current Date |
| 🟢 | `1690679715` | Deal | Date Stamp \| DA Resent Date |
| 🟢 | `367653809` | Deal | Date Stamp \| Date Sent to Engineering |
| 🟢 | `367568257` | Deal | Date Stamp \| Deal Start Date |
| 🟢 | `367655071` | Deal | Date Stamp \| Design Completion Date |
| 🟢 | `367653791` | Deal | Date Stamp \| Design Draft Completion Date |
| 🟢 | `367569793` | Deal | Date Stamp \| Design Rejection Date |
| 🟢 | `367568724` | Deal | Date Stamp \| Design Revision Complete Date |
| 🟢 | `367733511` | Deal | Date Stamp \| Final Inspection Fail Date |
| 🟢 | `367733765` | Deal | Date Stamp \| Final Inspection Pass Date |
| 🟢 | `367733262` | Deal | Date Stamp \| Final Inspection Start Date |
| 🟢 | `1667591237` | Deal | Date Stamp \| ICF Submit Date |
| 🟢 | `1700052496` | Deal | Date Stamp \| Inspection Booked Date |
| 🟢 | `367653697` | Deal | Date Stamp \| Kickoff Complete Date |
| 🟢 | `1674130959` | Deal | Date Stamp \| New Construction Design Completion Date |
| 🟢 | `1666163029` | Deal | Date Stamp \| PBSR Submit Date |
| 🟢 | `367676079` | Deal | Date Stamp \| Permit Issue Date |
| 🟢 | `367711598` | Deal | Date Stamp \| Permit Rejection Date |
| 🟢 | `367711604` | Deal | Date Stamp \| Permit Resubmit Date |
| 🟢 | `1693703286` | Deal | Date Stamp \| Permit Revision Complete Date |
| 🟢 | `367676047` | Deal | Date Stamp \| Permit Start Date |
| 🟢 | `367687349` | Deal | Date Stamp \| Permit Submit Date |
| 🟢 | `367687586` | Deal | Date Stamp \| Project Complete Date |
| 🟢 | `367569509` | Deal | Date Stamp \| Project Start Date |
| 🟢 | `367676202` | Deal | Date Stamp \| Ready To Build Date |
| ⚪ | `1667344801` | Deal | Date Stamp \| RRF Submit Date |
| ⚪ | `1693849631` | Deal | Date Stamp \| Second Permit Revision Complete Date |
| ⚪ | `1693849676` | Deal | Date Stamp \| Second Utility Revision Complete Date |
| 🟢 | `367569530` | Deal | Date Stamp \| Site Survey Booked Date |
| 🟢 | `367569545` | Deal | Date Stamp \| Site Survey Completion Date |
| 🟢 | `367569522` | Deal | Date Stamp \| Site Survey Start Date |
| ⚪ | `1693845526` | Deal | Date Stamp \| Third Permit Revision Complete Date |
| ⚪ | `1693849722` | Deal | Date Stamp \| Third Utility Revision Complete Date |
| ⚪ | `1695837094` | Deal | Date Stamp \| Today's Date |
| 🟢 | `1693849648` | Deal | Date Stamp \| Utility Revision Complete Date |
| 🟢 | `1662002596` | Deal | Date Stamp \| Waiting on Information Date |

## Bot Hook | / Bot Comms | (automation bots)  (14 flows · 10 on / 4 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| ⚪ | `1661583967` | Deal | Bot Comms \| Project Status Summary |
| ⚪ | `1661567337` | Deal | Bot Comms \| Stage Language for Permit Webhooks |
| ⚪ | `1661567267` | Deal | Bot Comms \| Stage Language for Webhooks |
| 🟢 | `1661602870` | Deal | Bot Comms \| Update Escalation Email |
| 🟢 | `1670515104` | Deal | Bot Hook \| Closeout |
| 🟢 | `1670515267` | Deal | Bot Hook \| Construction |
| 🟢 | `1665876314` | Deal | Bot Hook \| Design |
| 🟢 | `1670515269` | Deal | Bot Hook \| Inspection |
| 🟢 | `1703684425` | Deal | Bot Hook \| Inspection Weekly Update |
| 🟢 | `1667844515` | Deal | Bot Hook \| Permit |
| 🟢 | `1670515086` | Deal | Bot Hook \| Permit Weekly Update |
| 🟢 | `1703706391` | Deal | Bot Hook \| RTB Weekly Update |
| 🟢 | `1664080407` | Deal | Bot Hook \| Site Survey |
| ⚪ | `1704786774` | Deal | Bot Hook \| Site Survey Scheduling (IN TEST) |

## Service & Tickets (pipeline 0-5)  (29 flows · 19 on / 10 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| 🟢 | `1793326339` | Ticket | (NEW) HS Ticket -> Zuper [Creation, Updates] |
| ⚪ | `1627226804` | Ticket | [Monitoring] Troubleshoot ticket assignments |
| 🟢 | `1817837492` | Ticket | [PB Ops] Ticket Created → Property Sync |
| 🟢 | `1630395976` | Ticket | [PUSH] Webhook to Make Google Drive Folder for Tickets |
| 🟢 | `1610286515` | Ticket | Auto IT Ticket - Ticket |
| 🟢 | `592843665` | Ticket | Automated Reply Email - Service Ticket Submission |
| 🟢 | `617848977` | Ticket | Custom Object \| Customer Review \| Ticket Email Notification |
| 🟢 | `1705527909` | Ticket | Design In Progress (Ticket)  |
| 🟢 | `1705550456` | Ticket | Design Needed (Ticket) |
| 🟢 | `1705517749` | Ticket | Design Ready for Review (Ticket) |
| ⚪ | `1808680969` | Ticket | Link Ticket to Zuper Job |
| 🟢 | `323415621` | Ticket | PB Advantage Tag for Tickets |
| ⚪ | `197442580` | Ticket | PB Support: Automatically change ticket status when a customer replies to an email. |
| ⚪ | `197440328` | Ticket | PB Support: Automatically change ticket status when an email is sent to a customer. |
| 🟢 | `430189446` | Ticket | Pipeline is "PB Support", Ticket status is "Gathering Requirements" |
| 🟢 | `609878610` | Ticket | Send Ticket to Make.com for Geocoding if Address known but Long/Lat Unknown |
| 🟢 | `603169716` | Ticket | Service - Post Site Visit Follow-Up Task Workflow |
| ⚪ | `248344139` | Ticket | Service Pipeline: Automatically change ticket status when a customer replies to an email. |
| ⚪ | `248344137` | Ticket | Service Pipeline: Automatically change ticket status when an email is sent to a customer. |
| 🟢 | `1802903322` | Ticket | Service Ticket - Revisit Needed |
| 🟢 | `570720346` | Ticket | Stuck in Acknowledgement |
| ⚪ | `1702193961` | Ticket | Technical Operations Pipeline: Automatically change ticket status when an email is sent to a customer. |
| 🟢 | `570698146` | Ticket | Ticket Acknowledgement |
| 🟢 | `513190811` | Ticket | Ticket Assignments - IT Support |
| 🟢 | `504044693` | Ticket | Ticket Assignments - Service |
| ⚪ | `570699353` | Ticket | Ticket Kickoff |
| 🟢 | `1764003435` | Ticket | Ticket Owner for Zuper |
| ⚪ | `1625408539` | Ticket | Ticket to Zuper Job & Project |
| ⚪ | `1719692969` | Ticket | Unnamed workflow - 2025-11-07 22:30:04 GMT+0000 |

## Contacts / Marketing (0-1)  (66 flows · 45 on / 21 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| 🟢 | `1825154864` | Contact | [Dana] Stop AR Bot Communication |
| ⚪ | `1817836172` | Contact | [PB Ops] Contact Address → Property Sync |
| ⚪ | `575239986` | Contact | Acquisition Routing - Schedule Appointment Form |
| ⚪ | `1751136424` | Contact | Address Formatting (D&R) |
| 🟢 | `1625370800` | Contact | Address Formatting (manual) |
| 🟢 | `1634259357` | Contact | AI Bot Removal From Appointment Booking Campaign |
| 🟢 | `1625518370` | Contact | AI Bot Routing |
| 🟢 | `558537865` | Contact | Aircall Junk Capture |
| 🟢 | `266617202` | Contact | Appt Type Automation |
| ⚪ | `597624389` | Contact | Automated Outside Sales Sequence |
| 🟢 | `574978590` | Contact | Backup Power Form Submission Lead Source Change |
| 🟢 | `562813260` | Contact | CA: Newsletter Signup \| Lead Source + Automated Email |
| 🟢 | `562773262` | Contact | CO: Newsletter Signup \| Lead Source + Automated Email |
| 🟢 | `1612542548` | Contact | Comms Method on Form Submit |
| 🟢 | `1819588637` | Contact | Concatenate Notes for Sales with Dates |
| 🟢 | `1733111590` | Contact | Contact Recent Sentiment Copy to Deal |
| 🟢 | `1634721683` | Contact | Contact Us Lead Source Update |
| 🟢 | `1775318288` | Contact | Contact – Email/Phone Changed (for Primary Deal Sync) |
| ⚪ | `1658475104` | Contact | Convert Lifecycle Stage at Closed Won |
| 🟢 | `200054105` | Contact | Create New Deal |
| 🟢 | `558750285` | Contact | Create New Referral Button |
| 🟢 | `561511560` | Contact | Create New Ticket |
| 🟢 | `378035119` | Contact | Customer Name Push From Contact to Deal |
| ⚪ | `575224199` | Contact | D&R Routing - Schedule Appointment Form |
| 🟢 | `497819979` | Contact | Date Last Contacted Update on Deal |
| ⚪ | `605906823` | Contact | Email for Tesla Direct Leads |
| 🟢 | `358122137` | Contact | Employee email logging |
| 🟢 | `1629213031` | Contact | Estimator AI Agent |
| ⚪ | `1737383036` | Contact | Estimator Summary Copy to Deal |
| 🟢 | `1626980402` | Contact | Event Form Submission for Automated Email |
| 🟢 | `573927978` | Contact | Form Submission / Task to Charlie |
| ⚪ | `1834808686` | Contact | June 2026 Hail Text - NON PB Customers |
| ⚪ | `1838713645` | Contact | June 2026 Hail Text - NON PB Customers (cloned) |
| 🟢 | `1835307098` | Contact | June 2026 Hail Text - PB Customers  |
| 🟢 | `558375479` | Contact | Marketing Contact Automation |
| 🟢 | `1830887202` | Contact | May 2026 Hail Text - NON PB Customers |
| 🟢 | `557117357` | Contact | Missing Lead Source |
| ⚪ | `1733111584` | Contact | Negative Sentiment Notification (Contact) |
| 🟢 | `1821116718` | Contact | PB Tech Ops - Property Sync Workflow |
| 🟢 | `1654652172` | Contact | Populate Contact Owner Email |
| 🟢 | `346934932` | Contact | Populate Lead Source & Lead Status for Estimator Tool Leads |
| ⚪ | `1815737507` | Contact | Process no same day response |
| ⚪ | `1817837900` | Contact | Property Creation and Associations |
| 🟢 | `1838712146` | Contact | Q2 Promo Text 2026 - Colorado |
| 🟢 | `1643231598` | Contact | Re-assign Consultation No-Show |
| 🟢 | `225556790` | Contact | Referral Contact Formatting |
| 🟢 | `1632261895` | Contact | Self Booked Meeting Notification |
| ⚪ | `1627301790` | Contact | Self-Booked Consultation Follow Up Email |
| ⚪ | `575221781` | Contact | Send a follow-up email after form submission |
| ⚪ | `575255885` | Contact | Service Routing - Schedule Appt Form |
| 🟢 | `429552660` | Contact | Service Ticket Creation |
| 🟢 | `556807258` | Contact | Set Referral Title & Properties |
| 🟢 | `308742994` | Contact | Tag as Commercial Contact |
| 🟢 | `308742976` | Contact | Tag as Residential Contact |
| 🟢 | `1621202953` | Contact | Tesla Direct Lead / Task to Launch Hatch |
| 🟢 | `1795202160` | Contact | Tesla Rebate Registration Reminder |
| 🟢 | `1628680821` | Contact | Unenroll Sequence |
| ⚪ | `1652864361` | Contact | Unnamed workflow - 2025-05-08 18:39:15 GMT+0000 |
| ⚪ | `1784342131` | Contact | Unnamed workflow - 2026-02-28 23:28:50 GMT+0000 |
| ⚪ | `1813886783` | Contact | Unnamed workflow - 2026-04-30 16:48:34 GMT+0000 |
| ⚪ | `1838714452` | Contact | Unnamed workflow - 2026-06-18 15:34:50 GMT+0000 |
| 🟢 | `387306801` | Contact | Unsubscribe Contacts moved to Non-Marketing |
| 🟢 | `1634479952` | Contact | Webform Routing - Contact Us |
| ⚪ | `238621340` | Contact | Webform Routing - Event Lead |
| 🟢 | `238621346` | Contact | Webform Routing - Referral |
| 🟢 | `238617912` | Contact | Webform Routing - Solar Calculator |

## Ungrouped — ad-hoc, single-purpose & legacy  (380 flows · 293 on / 87 off)

| | ID | Obj | Workflow |
|---|---|---|---|
| 🟢 | `513237025` | Subscription | HubSpot Payments - Paid QBO Invoice Flow |
| 🟢 | `256374868` | Company | D&R Quote Signed / Closed Won |
| 🟢 | `1821632625` | Company | Signed Quote to G Drive |
| 🟢 | `1790678615` | Deal | (NEW) HS Deal -> Zuper [Creation, Updates] |
| ⚪ | `1621174156` | Deal | (Turned Off) Task to Order Placard for Inspection |
| 🟢 | `1762328370` | Deal | 00. Participate Energy Flow - Waiting on Contract |
| 🟢 | `1762334040` | Deal | 01. Participate Energy Flow - Ready for Onboarding |
| 🟢 | `1780222977` | Deal | 01. Service Flow \| Closed Won to New |
| 🟢 | `1667274162` | Deal | 02. CPA Flow - CPA Submitted |
| 🟢 | `1721220769` | Deal | 02. New Construction Flow - Design Reviewed |
| 🟢 | `1762328322` | Deal | 02. Participate Energy Flow - Onboarding Submitted |
| 🟢 | `1666162592` | Deal | 02a. 3CE EV Flow - Construction Complete |
| 🟢 | `1667249078` | Deal | 02a. SGIP Flow - RRF Waiting on Information |
| 🟢 | `1669310773` | Deal | 02b. SGIP Flow - RRF Information Collected |
| 🟢 | `1667274132` | Deal | 03. CPA Flow - Waiting on Information |
| 🟢 | `1762328113` | Deal | 03. Participate Energy Flow - Ready for M1 Submission |
| 🟢 | `1695835986` | Deal | 04. Construction Flow - RTB 5 Days Ago |
| 🟢 | `1669244698` | Deal | 04. CPA Flow - Information Collected by PM or Sales |
| 🟢 | `1743258275` | Deal | 04. New Construction Flow - RTB Drone |
| 🟢 | `1762300074` | Deal | 04. Participate Energy Flow - M1 Submitted |
| 🟢 | `1667272031` | Deal | 04. PBSR Flow - Waiting on Information |
| 🟢 | `1669310748` | Deal | 04a. 3CE EV Flow - Waiting on Information |
| 🟢 | `1665899078` | Deal | 04a. SGIP Flow - RRF Submitted |
| 🟢 | `1667257192` | Deal | 04b. 3CE Battery Flow - Waiting on Information |
| 🟢 | `1677990675` | Deal | 04b. SGIP Flow - RRF Sent For Signature |
| 🟢 | `1678000968` | Deal | 04c. SGIP Flow - RRF Signed |
| 🟢 | `1677990697` | Deal | 04d. SGIP Flow - RRF Submitted To Waitlist |
| 🟢 | `1678001010` | Deal | 04e. SGIP Flow - RRF Resubmitted |
| 🟢 | `1677998654` | Deal | 04f. SGIP Flow - RRF Suspended |
| 🟢 | `1695850243` | Deal | 05. Construction Flow - Construction Scheduled 5 Days Ago |
| 🟢 | `1762333196` | Deal | 05. Participate Energy Flow - Ready for M2 Submission |
| 🟢 | `1669262857` | Deal | 05. PBSR Flow - Information Collected by PM or Sales |
| 🟢 | `1667328066` | Deal | 05. SGIP Flow - RRF Confirmed |
| 🟢 | `1669310745` | Deal | 05a. 3CE EV Flow - Information Collected by PM or Sales |
| 🟢 | `1669310757` | Deal | 05b. 3CE Battery Flow - Information Collected by PM or Sales |
| 🟢 | `605593191` | Deal | 06. Construction Flow - Design Rejected |
| 🟢 | `1762328160` | Deal | 06. Participate Energy Flow - M2 Submitted |
| 🟢 | `1620073860` | Deal | 06.2 PM Task - Final Inspection Rejected  |
| 🟢 | `1667893086` | Deal | 06a. 3CE EV Flow - SGIP Rebate Paid |
| 🟢 | `1667893065` | Deal | 06b. 3CE Battery Flow - SGIP Rebate Paid |
| 🟢 | `605593991` | Deal | 07. Construction Flow - In Design For Revision |
| 🟢 | `1667257126` | Deal | 07. SGIP Flow - ICF Waiting on Information |
| 🟢 | `605567339` | Deal | 08. Construction Flow - Revision Returned From Design |
| 🟢 | `1669262851` | Deal | 08. SGIP Flow - ICF Information Collected by PM |
| 🟢 | `1695826960` | Deal | 09. Construction Flow - Loose Ends Remaining |
| 🟢 | `1667620750` | Deal | 09a. SGIP Flow - ICF Submitted |
| 🟢 | `1677998623` | Deal | 09b. SGIP Flow - ICF Sent For Signature |
| 🟢 | `1677998620` | Deal | 09c. SGIP Flow - ICF Signed |
| 🟢 | `1677998632` | Deal | 09d. SGIP Flow - ICF Resubmitted |
| 🟢 | `1677998659` | Deal | 09e. SGIP Flow - ICF Suspended |
| 🟢 | `1678298149` | Deal | 09f. SGIP Flow - ICF Inspection Requested |
| 🟢 | `1667328061` | Deal | 10. SGIP Flow - Rebate Canceled |
| 🟢 | `1678001003` | Deal | 11. SGIP Flow - Project Canceled |
| 🟢 | `1670703007` | Deal | 11a. SGIP Flow - Expires in 45 Days |
| 🟢 | `1670709283` | Deal | 11b. SGIP Flow - Expires in 30 Days |
| ⚪ | `596872489` | Deal | 25K Deals Signed Q3 Email Workflow |
| 🟢 | `444752176` | Deal | 30 Days Without DA Email |
| 🟢 | `1790076182` | Deal | 3CE Battery Flow - Paid in Full |
| 🟢 | `1790141233` | Deal | 3CE Battery Flow - Ready To Submit |
| ⚪ | `616143518` | Deal | 3CE Battery Rebate Application Reminder \| SLO |
| 🟢 | `1780643091` | Deal | 3CE EV Flow - Paid in Full |
| ⚪ | `1662002546` | Deal | 3CE EV Rebate Application Reminder \| SLO |
| 🟢 | `1705826726` | Deal | 3CE Rebate Follow-up: 90 Days After Close Out |
| 🟢 | `1816013899` | Deal | [Helios] Large Deal Sold |
| 🟢 | `1824706708` | Deal | [Olivia] Cancelled/Lost Cleanup |
| 🟢 | `1824679184` | Deal | [Olivia] Deal Ingestion |
| 🟢 | `1824679265` | Deal | [Olivia] Property Sync |
| 🟢 | `1817840508` | Deal | [PB Ops] Deal Created → Property Sync |
| 🟢 | `1647378333` | Deal | [PUSH-STAGING] 04_12_25 A# |
| ⚪ | `1647346507` | Deal | [PUSH-STAGING] 04_12_25 U# |
| ⚪ | `1625371979` | Deal | [Push] - Alert for Deal Creation |
| 🟢 | `1626617174` | Deal | [PUSH] One-off Google Drive Structure |
| ⚪ | `1627035286` | Deal | [Push] Send notification when OS Monitoring Deals List membership grows |
| 🟢 | `1793771092` | Deal | [Schedule] Check if deals are paid in full |
| 🟢 | `1639897428` | Deal | [STAGING-PUSH] 021625_A |
| 🟢 | `1647318437` | Deal | [STAGING-PUSH] 021625_U |
| 🟢 | `1603831223` | Deal | A01. Loan Requirements Collect/Upload Task |
| 🟢 | `1603868565` | Deal | A02. Loan Requirements Review Task for Accounting |
| ⚪ | `1688136207` | Deal | A03. DA Invoice Paid |
| ⚪ | `1770080666` | Deal | A04. CC Invoice Paid |
| 🟢 | `1779707955` | Deal | Accounting Flow - EV Invoice Paid |
| 🟢 | `1779639414` | Deal | Accounting Flow - M1 & M2 & M3 Paid |
| ⚪ | `1668199685` | Deal | Accounting Invoice Associations |
| 🟢 | `1693414999` | Deal | AHJ Association |
| 🟢 | `1692337796` | Deal | As-Built Revision Counter |
| 🟢 | `1696107085` | Deal | As-Built Revision Counter Value Set |
| 🟢 | `1824676980` | Deal | Attestation P.E. PandaDoc Creation when DA & CC Paid |
| 🟢 | `410099067` | Deal | Auto IT Ticket - Deal |
| 🟢 | `1705614942` | Deal | Auto Tech Ops Ticket - Deal |
| 🟢 | `1722487417` | Deal | Auto Ticket Wes - Deal  |
| 🟢 | `1637475848` | Deal | Automated Project Thread Note |
| ⚪ | `1651993640` | Deal | Automated Project Thread Note (cloned) |
| 🟢 | `1722486874` | Deal | Automated Project Thread Note (Close Out) |
| 🟢 | `1722373557` | Deal | Automated Project Thread Note (P&I) |
| ⚪ | `1741150284` | Deal | Battery Count Set |
| ⚪ | `1741150285` | Deal | Battery Expansion Count Set |
| 🟢 | `1723236747` | Deal | Battery Expansion Qty Set |
| ⚪ | `1723236521` | Deal | Battery Qty Set |
| 🟢 | `1810127187` | Deal | BOM Pipeline - Service Design Complete |
| 🟢 | `1626416446` | Deal | BUS Task - Design Complete - SCE |
| 🟢 | `1626413372` | Deal | BUS Task - Schedule back up switch appointment - Construction Complete |
| 🟢 | `1767153335` | Deal | Cancel Job |
| 🟢 | `1839342188` | Deal | CC Invoice Paid |
| 🟢 | `1717111356` | Deal | CC Last 365 Days |
| 🟢 | `1717105994` | Deal | CC Not Last 365 Days |
| 🟢 | `1839840318` | Deal | Check Here Property Cleared |
| 🟢 | `1770877767` | Deal | Close Deal With Quote |
| 🟢 | `1732041573` | Deal | Close-Out Gift Code Email  |
| 🟢 | `1715877292` | Deal | Closed Last 365 Days |
| 🟢 | `1761117473` | Deal | Closed Lost (180 Days Inactive) |
| 🟢 | `1715877404` | Deal | Closed Not Last 365 Days |
| 🟢 | `1799782036` | Deal | CoA and Waivers P.E. PandaDoc Creation at CC |
| 🟢 | `606005379` | Deal | Commission Type Deal Flow |
| 🟢 | `1755534407` | Deal | Complete REC Warranty Registration |
| 🟢 | `1705123428` | Deal | Construction Complete |
| 🟢 | `1815736956` | Deal | Construction Complete |
| 🟢 | `1805565467` | Deal | Construction Flow: Schedule Install |
| 🟢 | `611113776` | Deal | Construction Scheduled |
| ⚪ | `1692259114` | Deal | Construction Scheduled |
| 🟢 | `1816621482` | Deal | Construction Subjob In Progress |
| 🟢 | `1816621476` | Deal | Construction Subjob Loose Ends Remaining |
| 🟢 | `1816549506` | Deal | Construction Subjob On Our Way |
| 🟢 | `1816621484` | Deal | Construction Subjob Return Scheduled |
| 🟢 | `1816621991` | Deal | Construction Subjob Scheduled |
| 🟢 | `1816549505` | Deal | Construction Subjob Started |
| 🟢 | `1783360140` | Deal | Copy Phone Number from Primary Contact |
| 🟢 | `1823569000` | Deal | CORE Disco / Reco Needed |
| 🟢 | `1740568491` | Deal | CPA Expiration in 30 Days |
| 🟢 | `1817933184` | Deal | Create and Deliver SO Shipments |
| 🟢 | `1823390238` | Deal | Create DA PandaDoc |
| 🟢 | `1818409347` | Deal | Create Fire Inspection Zuper Job |
| 🟢 | `237296672` | Deal | Create Google Map Link |
| 🟢 | `1791238001` | Deal | Create Monitoring Site |
| ⚪ | `563925268` | Deal | Create QBO Estimate |
| 🟢 | `1835667600` | Deal | Create Site Survey Revisit Job |
| 🟢 | `1773951772` | Deal | Create Veterans Promo Task |
| 🟢 | `617848934` | Deal | Custom Object \| Customer Review \| Deal Email Notification |
| 🟢 | `1759322707` | Deal | D&R - Closed Won |
| 🟢 | `1723055006` | Deal | D&R - Detach Complete |
| 🟢 | `1723027853` | Deal | D&R - Detach Scheduled |
| 🟢 | `1731986761` | Deal | D&R - Inspection Passed or Not Needed |
| 🟢 | `1723134091` | Deal | D&R - Reset Complete |
| 🟢 | `1723055003` | Deal | D&R - Reset Scheduled |
| ⚪ | `513852520` | Deal | D&R Detach Milestone Date Stamps |
| 🟢 | `569736596` | Deal | D&R Invoice Past Due - 10 Days |
| 🟢 | `569969559` | Deal | D&R Invoice Past Due - 20 Days |
| 🟢 | `569958295` | Deal | D&R Invoice Past Due - 30 Days |
| 🟢 | `569966986` | Deal | D&R Invoice Past Due - 45 Days |
| 🟢 | `568988940` | Deal | D&R Invoice Past Due - 5 Days |
| ⚪ | `513811325` | Deal | D&R Reset Milestone Date Stamps |
| 🟢 | `513850784` | Deal | D&R \| M1 & M2 Amount Update |
| 🟢 | `1839342124` | Deal | DA Invoice Paid |
| 🟢 | `1715877298` | Deal | DA Last 365 Days |
| 🟢 | `1715823429` | Deal | DA Not Last 365 Days |
| 🟢 | `1692338055` | Deal | DA Revision Counter |
| 🟢 | `1696110175` | Deal | DA Revision Counter Value Set |
| 🟢 | `1793712414` | Deal | Deal -> Zoho for Shipment [On Day of Construction] |
| 🟢 | `371616136` | Deal | Deal Naming |
| 🟢 | `519287082` | Deal | Deal Sequencer |
| 🟢 | `430128161` | Deal | Deal Stuck For 120 Days |
| 🟢 | `430108560` | Deal | Deal Stuck For 30 Days |
| 🟢 | `430128146` | Deal | Deal Stuck For 60 Days |
| 🟢 | `430127992` | Deal | Deal Stuck For 90 Days |
| ⚪ | `240377627` | Deal | Deal to AHJ Association |
| ⚪ | `240808541` | Deal | Deal to Utility Association |
| ⚪ | `1747875073` | Deal | Deal to Zuper Job |
| ⚪ | `1625408558` | Deal | Deal to Zuper Job and Project |
| ⚪ | `1747858084` | Deal | Deal to Zuper Project |
| 🟢 | `1708375435` | Deal | Deals that need to be converted to 2026/ESA install |
| 🟢 | `1797118999` | Deal | Delete Cancelled Deals Open/Pending Tasks |
| 🟢 | `455648598` | Deal | Denver Rebates Notification |
| 🟢 | `1810800163` | Deal | EagleView TrueDesign Auto-Order (Day Before Survey) |
| 🟢 | `1743608090` | Deal | Email for Reviews at Construction Complete |
| ⚪ | `1741121166` | Deal | Equipment Verification for Completed Site Survey |
| ⚪ | `1763464858` | Deal | ESA Record Spreadsheet Import/Update |
| 🟢 | `1797892115` | Deal | Final Design Review Check |
| ⚪ | `1693783944` | Deal | First As-Built Rejection Reason |
| 🟢 | `1693914162` | Deal | First DA Rejection Reason |
| ⚪ | `1693782283` | Deal | First Permit Rejection Reason |
| 🟢 | `1715688730` | Deal | First Time Inspection Pass |
| 🟢 | `1718445096` | Deal | First Time Inspection Pass (Not Rejected) |
| ⚪ | `1693782352` | Deal | First Utility Rejection Reason |
| 🟢 | `266723873` | Deal | Forecast Category Mapping for Pipeline: Sales Pipeline |
| 🟢 | `1658085895` | Deal | G-Drive Folders |
| 🟢 | `1697295661` | Deal | Generic Revision Counter Value Set |
| ⚪ | `1712152932` | Deal | GET Sales Tax |
| 🟢 | `589103542` | Deal | Go Green Payment Method Flow |
| 🟢 | `1719692979` | Deal | Google Chat Notification (Testing) |
| ⚪ | `1625427533` | Deal | HubSpot Deal to Zuper Project Status Sync  |
| 🟢 | `1820412779` | Deal | IDR Revision Counter |
| 🟢 | `1824183154` | Deal | IDR Revision Needed |
| 🟢 | `1714705193` | Deal | Inspection Automated Note  |
| 🟢 | `1715777876` | Deal | Inspection Fail (365 Days) |
| 🟢 | `1715810569` | Deal | Inspection Fail (Not 365 Days) |
| 🟢 | `1715107844` | Deal | Inspection Failed |
| 🟢 | `1718441753` | Deal | Inspection Failed (Not Rejected) |
| 🟢 | `1715689371` | Deal | Inspection Pass (365 Days) |
| 🟢 | `1715713816` | Deal | Inspection Pass (Not 365 Days) |
| 🟢 | `1705120101` | Deal | Inspection Passed |
| 🟢 | `1692277133` | Deal | Inspection Scheduled |
| ⚪ | `1797950828` | Deal | Install Photo Review |
| 🟢 | `1797951041` | Deal | Install Photo Review |
| 🟢 | `1840159585` | Deal | Internal M1 Rejection Notes Update |
| 🟢 | `1840159587` | Deal | Internal M2 Rejection Notes Update |
| 🟢 | `1723254694` | Deal | Inverter Qty Set |
| 🟢 | `1637343661` | Deal | Invoice Paid Notification To Sales |
| 🟢 | `1775922501` | Deal | Is Participate Energy? |
| ⚪ | `1702159766` | Deal | Itemized Receipt |
| 🟢 | `1736837421` | Deal | Itemized Receipt (cloned) |
| 🟢 | `1637384510` | Deal | Lien Process - 45 Days Late (Task) |
| 🟢 | `271370931` | Deal | line item update in deal property |
| ⚪ | `1739507096` | Deal | line item update in deal property (testing) |
| 🟢 | `1689331593` | Deal | Line Items Updated Notification |
| 🟢 | `1808743709` | Deal | Link Deal to Zuper Job |
| 🟢 | `346430210` | Deal | Link To OpenSolar |
| 🟢 | `251999240` | Deal | Loan Rejected |
| 🟢 | `1698671249` | Deal | Location Association |
| 🟢 | `1837771604` | Deal | M1 Docs Approved |
| 🟢 | `1837622369` | Deal | M1 Docs Submitted |
| 🟢 | `502539688` | Deal | M1 Invoice Test |
| 🟢 | `1837771387` | Deal | M1 Paid Date |
| 🟢 | `1839840408` | Deal | M1 Rejection Notes Update |
| ⚪ | `1837771852` | Deal | M2 Docs Approved |
| 🟢 | `1837775000` | Deal | M2 Docs Approved |
| 🟢 | `1837625959` | Deal | M2 Docs Submitted |
| 🟢 | `1837771388` | Deal | M2 Paid Date |
| 🟢 | `1839840409` | Deal | M2 Rejection Notes Update |
| ⚪ | `1754874191` | Deal | Manually Triggered Zuper Project |
| ⚪ | `1754816172` | Deal | Manually Triggered Zuper Site Survey Job |
| 🟢 | `1610226804` | Deal | Marketing Email - 5-Star Review Associations (CA)  |
| 🟢 | `1610223661` | Deal | Marketing Email - 5-Star Review Associations (CO)  |
| 🟢 | `1705459795` | Deal | Missing SKU Notification |
| 🟢 | `1723303551` | Deal | Module Qty Set |
| 🟢 | `1755534430` | Deal | Monitoring Site Setup Date |
| 🟢 | `1755590487` | Deal | Monitoring Site Setup Required |
| 🟢 | `1764082615` | Deal | Move to Nuture |
| 🟢 | `1733199990` | Deal | Negative Sentiment Notification (Deal) |
| 🟢 | `252072604` | Deal | New Vs Existing Business |
| ⚪ | `1624960785` | Deal | NO Design Needed - EV CHARGER ONLY |
| 🟢 | `1718462641` | Deal | Note from Zuper |
| 🟢 | `1652332358` | Deal | Notification \| Loan Expiration |
| ⚪ | `1783360073` | Deal | One Time Copy to Previous |
| ⚪ | `1744785705` | Deal | OS CHANGE ORDERS |
| 🟢 | `1823673523` | Deal | Other Utilities Disco / Reco Needed |
| 🟢 | `1819586431` | Deal | P.E. M1 Approved |
| 🟢 | `1821003776` | Deal | P.E. M1 Paid |
| 🟢 | `1820989559` | Deal | P.E. M2 Approved |
| 🟢 | `1820992053` | Deal | P.E. M2 Paid |
| ⚪ | `1760341606` | Deal | Participate Data Upload |
| 🟢 | `1796833189` | Deal | Participate Energy Removed |
| ⚪ | `1760342286` | Deal | Participate Onboarding Sheet - Create Record |
| ⚪ | `1663181207` | Deal | PBSR Rebate Application Reminder \| SLO |
| 🟢 | `1762876960` | Deal | PE Contract Completed |
| 🟢 | `1762484327` | Deal | PE Contract Sent |
| 🟢 | `1617493864` | Deal | Permit Lead Complete Arapahoe Checklist |
| 🟢 | `1652033561` | Deal | Permit Not Needed |
| 🟢 | `1692338050` | Deal | Permit Revision Counter |
| 🟢 | `1696111490` | Deal | Permit Revision Counter Value Set |
| ⚪ | `1637362502` | Deal | PGE Rebate Application Reminder \| CA |
| ⚪ | `1677914807` | Deal | Pipeline is "Project Pipeline", stage is "Site Survey" |
| 🟢 | `530827375` | Deal | Pipeline is "Sales Pipeline", deal stage is "Proposal Submitted" |
| 🟢 | `530901058` | Deal | Pipeline is "Sales Pipeline", deal stage is "Sales Follow Up" |
| ⚪ | `603084330` | Deal | PM Email - Phase 1: Welcome Email |
| ⚪ | `603121925` | Deal | PM Email - Phase 2: Site Survey to Design |
| ⚪ | `603121559` | Deal | PM Email - Phase 3: Design to Permitting |
| ⚪ | `603121953` | Deal | PM Email - Phase 4: Permitting to Construction |
| ⚪ | `603121964` | Deal | PM Email - Phase 5: Construction to Inspection |
| 🟢 | `1721482899` | Deal | PM Notifications - Follow Ups |
| ⚪ | `1604137087` | Deal | PM. Backup Switch Application Task  |
| 🟢 | `1654661677` | Deal | Populate Current PM For Contact |
| 🟢 | `1654661778` | Deal | Populate PM Email |
| ⚪ | `1774406515` | Deal | Populate Pre-Sales Checklist Missing |
| ⚪ | `1671936624` | Deal | Preconstruction Form Review Task for Sales |
| 🟢 | `1791044865` | Deal | Primary Contact Update |
| 🟢 | `251375963` | Deal | Project Close Out Task Creation |
| 🟢 | `567547063` | Deal | Project Invoice Past Due - 10 Days |
| 🟢 | `567518810` | Deal | Project Invoice Past Due - 20 Days |
| 🟢 | `567524728` | Deal | Project Invoice Past Due - 30 Days |
| 🟢 | `567550481` | Deal | Project Invoice Past Due - 45 Days |
| 🟢 | `567517457` | Deal | Project Invoice Past Due - 5 Days |
| 🟢 | `1621633836` | Deal | Project Invoice Past Due - 60 Days |
| 🟢 | `1621648457` | Deal | Project Invoice Past Due - 75 Days |
| 🟢 | `1621648458` | Deal | Project Invoice Past Due - 90 Days |
| 🟢 | `1626401320` | Deal | Project Kickoff Task for PM |
| 🟢 | `377803908` | Deal | Project Location Automation |
| 🟢 | `407790448` | Deal | Project Type Automation - Battery |
| 🟢 | `407769383` | Deal | Project Type Automation - Electrical |
| 🟢 | `407790457` | Deal | Project Type Automation - EV Charger |
| 🟢 | `407784762` | Deal | Project Type Automation - PV |
| ⚪ | `1723703418` | Deal | Project Type Automation - PV Removed |
| 🟢 | `271244414` | Deal | Project Type Selection From Line Items |
| 🟢 | `1635820556` | Deal | Promotion Payout Task |
| 🟢 | `1766555200` | Deal | Q1 Tesla Cash Rebate -  How to Register |
| 🟢 | `1766555683` | Deal | Q1 Tesla Cash Rebate -  Submit for Rebate |
| 🟢 | `1743608218` | Deal | Ready for Detach & Permit \| D&R |
| 🟢 | `1693499670` | Deal | Rebate Association |
| 🟢 | `558743369` | Deal | Referral Payout Task |
| 🟢 | `430128165` | Deal | Reset Stuck Deal Counter |
| 🟢 | `1691779724` | Deal | Revision Counter |
| 🟢 | `1696109843` | Deal | Revision Counter Value Set |
| 🟢 | `1715804760` | Deal | RTB Last 365 Days |
| 🟢 | `1715813172` | Deal | RTB Not Last 365 Days |
| 🟢 | `1793826916` | Deal | RTB Sales Order Creation |
| 🟢 | `1770878351` | Deal | Sales Action - Cancelled |
| 🟢 | `1770832545` | Deal | Sales Action - Closed Lost |
| 🟢 | `1771911697` | Deal | Sales Action - LightReach |
| 🟢 | `1770877992` | Deal | Sales Action - No Dependent Fields |
| 🟢 | `1771309951` | Deal | Sales Action \| Spin Off EV Job |
| 🟢 | `308857922` | Deal | Sales Flow Automation - Proposal Submitted to Finalizing Deal |
| ⚪ | `395510287` | Deal | Sales Thank You - CC Email To All Contacts |
| 🟢 | `1809958508` | Deal | SCE BUS Task - Construction Complete |
| ⚪ | `1693853225` | Deal | Second As-Built Rejection Reason |
| 🟢 | `1693911673` | Deal | Second DA Rejection Reason |
| ⚪ | `1693781152` | Deal | Second Permit Rejection Reason |
| ⚪ | `1693702782` | Deal | Second Utility Rejection Reason |
| 🟢 | `609875578` | Deal | Send Deal to Tray.io for Geocoding if Address known but Long/Lat Unknown |
| 🟢 | `1786338984` | Deal | Send measurements in RoofR |
| ⚪ | `1617559374` | Deal | Send Webhook to Trayio on Deal Creation |
| 🟢 | `1798256392` | Deal | Service Deal \| Stuck in New |
| ⚪ | `1778415180` | Deal | Service Flow - Ready for P&I |
| 🟢 | `415803706` | Deal | Set Close Date When Missing |
| 🟢 | `451525424` | Deal | Set ESS Flag |
| 🟢 | `366619420` | Deal | Set PV Flag |
| 🟢 | `1790075914` | Deal | Share Monitoring with Participate |
| 🟢 | `1808650855` | Deal | Site Survey Notes for Roofing |
| 🟢 | `1808682351` | Deal | Site Survey Notes for Service |
| 🟢 | `1797891948` | Deal | Site Survey Readiness Check |
| 🟢 | `1816477561` | Deal | Submit Backup Switch - Not SCE |
| ⚪ | `1693852799` | Deal | Third As-Built Rejection Reason |
| 🟢 | `1693911675` | Deal | Third DA Rejection Reason |
| ⚪ | `1693702712` | Deal | Third Permit Rejection Reason |
| ⚪ | `1693845116` | Deal | Third Utility Rejection Reason |
| 🟢 | `1791042695` | Deal | Transition from Construction back to RTB |
| 🟢 | `1714909562` | Deal | Transition from RTB to RTB - Blocked |
| 🟢 | `1753784590` | Deal | Trigger Attaching OS Proposal To HS and Google Drive |
| 🟢 | `1746153834` | Deal | Trigger Participate Energy PandaDoc Contract Creation |
| 🟢 | `1837620130` | Deal | Trigger Zoho PDF Upload to Install Folder |
| 🟢 | `1823568475` | Deal | United Power Disco / Reco Needed |
| ⚪ | `1652363912` | Deal | Unnamed workflow - 2025-05-06 16:50:34 GMT+0000 |
| ⚪ | `1661907225` | Deal | Unnamed workflow - 2025-06-11 17:09:36 GMT+0000 |
| 🟢 | `1672495160` | Deal | Unnamed workflow - 2025-07-16 14:52:26 GMT+0000 |
| ⚪ | `1700748823` | Deal | Unnamed workflow - 2025-10-02 19:01:23 GMT+0000 |
| ⚪ | `1701256291` | Deal | Unnamed workflow - 2025-10-03 23:43:35 GMT+0000 |
| ⚪ | `1722507907` | Deal | Unnamed workflow - 2025-11-12 17:47:18 GMT+0000 |
| ⚪ | `1722619818` | Deal | Unnamed workflow - 2025-11-12 22:37:47 GMT+0000 |
| ⚪ | `1751169974` | Deal | Unnamed workflow - 2025-12-29 17:27:22 GMT+0000 |
| ⚪ | `1761011067` | Deal | Unnamed workflow - 2026-01-16 21:54:53 GMT+0000 |
| ⚪ | `1761116311` | Deal | Unnamed workflow - 2026-01-16 22:13:36 GMT+0000 |
| ⚪ | `1802896564` | Deal | Unnamed workflow - 2026-04-09 17:45:56 GMT+0000 |
| 🟢 | `570449164` | Deal | Update AHJ  |
| 🟢 | `1775893078` | Deal | Update Cancellation Date when Deal Stage is Cancelled |
| 🟢 | `570462284` | Deal | Update Utility Company |
| ⚪ | `1625443641` | Deal | Update Zuper Job custom fields |
| 🟢 | `1693459002` | Deal | Utility Association |
| 🟢 | `1778367356` | Deal | Utiltiy Flow - As-Built Revision Ready to Resubmit |
| ⚪ | `1745130282` | Deal | Zach's Action Set |
| ⚪ | `1740715334` | Deal | Zuper Job Completed |
| ⚪ | `1740711284` | Deal | Zuper Job Construction Complete |
| ⚪ | `1740715355` | Deal | Zuper Job Failed |
| ⚪ | `1740715884` | Deal | Zuper Job On Our Way |
| ⚪ | `1740710581` | Deal | Zuper Job Passed |
| ⚪ | `1777776208` | Deal | Zuper Job Ready to Schedule |
| ⚪ | `1779708032` | Deal | Zuper Job Return Visit Required |
| ⚪ | `1740913158` | Deal | Zuper Job Scheduled |
| ⚪ | `1740714081` | Deal | Zuper Job Started |
| 🟢 | `1735581100` | Deal | Zuper Project Team |
| 🟢 | `1732094818` | Deal | Zuper Revision Reason ---> As-Built Revision Reason |
| ⚪ | `1632827907` | Deal | Zuper SLA |
| 🟢 | `1634440608` | Deal | Zuper SLA - Construction |
| 🟢 | `1634444880` | Deal | Zuper SLA - Inspection |
| 🟢 | `1634461460` | Deal | Zuper SLA @ deal creation |
| 🟢 | `1795793187` | Mktg Event | Trigger Deal Creation Workflow With Appt |
| 🟢 | `519253302` | Lead | Invoice Sync With Google Sheets |
| ⚪ | `1624429407` | Lead | Invoice Test |
| 🟢 | `1621616021` | Lead | Lien Process - 30 Days late |
| 🟢 | `1799675707` | Lead | PE Invoice Milestones |
| ⚪ | `1770169891` | Lead | Unnamed workflow - 2026-02-02 21:48:12 GMT+0000 |
| ⚪ | `1779636498` | Lead | Update EV Milestones |
| 🟢 | `1770002522` | Lead | Update Invoice Milestones  |
| 🟢 | `558735177` | Custom obj | Set Referral Payout Info on New Contact |
