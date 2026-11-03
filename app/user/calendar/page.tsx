import React, { Suspense } from "react";
import CalendarUser from "../../components/CalendarUser";
import { SectionLoader } from "../../components/Loader";

export default function UserCalendarPage() {
  return (
    <div className="w-full h-full">
      <Suspense fallback={<SectionLoader text="Loading calendar…" />}>
        <CalendarUser />
      </Suspense>
    </div>
  );
}
