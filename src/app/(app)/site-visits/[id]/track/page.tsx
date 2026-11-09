import { notFound as nfPage } from "next/navigation";
import { ArrowLeft, Radar } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { getVisitTracking } from "@/lib/services/site-visits";
import { getMapRuntime } from "@/lib/services/maps";
import { Card, LinkButton, Notice, PageHeader } from "@/components/ui";
import { TripTracker } from "@/components/site-visits/trip-tracker";
import { TrackingDetail } from "@/components/site-visits/tracking-detail";
import { TripCorrection } from "@/components/site-visits/trip-correction";
import { TrackingPrivacyNotice } from "@/components/site-visits/tracking-ui";

export const metadata = { title: "Trip tracker" };

export default async function TrackVisitPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageContext("staff");
  const ctx = await requirePageContext("site_visit.manage");
  const { id } = await params;
  // 404 for anyone outside the employee's reporting chain (never leak existence).
  const data = await getVisitTracking(ctx, id).catch(() => null);
  if (!data) nfPage();
  const { visit, venture, summary, viewer } = data;
  const map = await getMapRuntime(ctx);
  const trackable = visit.status === "scheduled" || summary.stage !== "not_started";

  return (
    <>
      <PageHeader
        eyebrow="Site visits"
        title={viewer.isAssignee ? "Trip tracker" : "Trip timeline"}
        subtitle={viewer.isAssignee
          ? "Record each stage of your site visit. Location is shared only during this trip, only while this page is open."
          : `${visit.employeeName ?? "Employee"}'s trip for the visit with ${visit.visitorName}. Read-only.`}
        actions={
          <>
            <LinkButton href={`/site-visits?focus=${visit.id}`} variant="outline"><ArrowLeft size={16} />Site visits</LinkButton>
            {!viewer.isAssignee && <LinkButton href="/site-visits/tracking" variant="outline"><Radar size={16} />Team tracking</LinkButton>}
          </>
        }
      />

      {viewer.isAssignee ? (
        <div className="space-y-6">
          <Card className="p-4 sm:p-5">
            {trackable ? (
              <TripTracker
                visitId={visit.id}
                visitorName={visit.visitorName}
                visitStatus={visit.status}
                venture={{ name: venture.name, centre: venture.centre, radiusM: venture.radiusM }}
                initial={{
                  id: visit.id, status: visit.status, stage: summary.stage, consentAt: visit.consentAt,
                  tripStartedAt: summary.tripStartedAt, arrivedAt: summary.arrivedAt, visitStartedAt: summary.visitStartedAt,
                  visitCompletedAt: summary.visitCompletedAt, leftSiteAt: summary.leftSiteAt, returnedAt: summary.returnedAt,
                  totalDistanceM: summary.totalDistanceM,
                }}
              />
            ) : (
              <Notice tone="warning" title="This visit cannot be tracked">Only a scheduled visit can be tracked. This visit is {visit.status.replace(/_/g, " ")}.</Notice>
            )}
            {!venture.centre && trackable && (
              <div className="mt-4"><Notice tone="info">This venture has no map coordinates yet, so arrival will not be detected automatically — use the stage buttons.</Notice></div>
            )}
          </Card>
          <TrackingPrivacyNotice retentionNote={data.retentionNote} />
          {summary.stage !== "not_started" && (
            <Card className="p-4 sm:p-5">
              <h2 className="mb-3 text-base font-bold">Trip record</h2>
              <TrackingDetail data={data} showPrivacy={false} map={map} />
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <TrackingDetail data={data} map={map} />
          </Card>
          {viewer.canCorrect && summary.stage !== "not_started" && <TripCorrection visitId={visit.id} stage={summary.stage} visitStatus={visit.status} />}
        </div>
      )}
    </>
  );
}
