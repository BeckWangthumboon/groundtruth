import { Suspense } from "react";
import ExploreScene from "@/components/groundtruth/ExploreScene";

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ExploreScene />
    </Suspense>
  );
}
