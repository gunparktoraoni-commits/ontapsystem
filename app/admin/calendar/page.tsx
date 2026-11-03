"use client";

import { Suspense } from "react";
import CalendarUser from "../../components/CalendarUser";
import { SectionLoader } from "../../components/Loader";

export default function AdminCalendarPage() {
  return (
    <div className="w-full h-full">
      <Suspense fallback={<SectionLoader text="Loading calendar…" />}>
        <CalendarUser />
      </Suspense>
    </div>
  );
}
