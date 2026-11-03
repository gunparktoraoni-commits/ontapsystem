# Attendance & Event Monitoring — Visual Flowcharts

**Document version:** 1.1  
**Date:** September 7, 2026  
**Status:** Visual companion — Mermaid + PNG flowchart images  
**Scope:** Presentation-ready flowcharts for Attendance & Event Monitoring  

**Single source of truth:** [`Attendance & Event Monitoring.md`](Attendance%20&%20Event%20Monitoring.md)  
**PNG folder:** [`attendance-flowcharts/`](attendance-flowcharts/)

---

## How to use this document

Open this file in a Markdown previewer to see **PNG flowchart images** and Mermaid diagrams. Images are for presentation; Mermaid remains the editable source for structure.

---

## 1. System at a glance

![System at a glance](attendance-flowcharts/01-system-at-a-glance.png)

**Source:** Architecture §§1–2, §6

```mermaid
flowchart TD
  subgraph Org["Company Admin Portal"]
    Create[Create / configure ManagedEvent]
    Monitor[Monitor / export]
  end
  subgraph Member["User Portal"]
    View[View event]
    Reg[Register / RSVP if required]
    Confirm[Attendance confirmation]
  end
  subgraph Venue["Venue door"]
    NFC[NFC tap]
    QR[QR scan]
    Manual[Manual entry]
  end
  Create --> ManagedEvent
  View --> ManagedEvent
  Reg --> EventRegistration
  NFC --> CheckInAPI[Check-in API]
  QR --> CheckInAPI
  Manual --> CheckInAPI
  CheckInAPI --> Elig[Eligibility service]
  Elig --> CompanyEmployee
  Elig --> MembershipAPI["Membership API - FUTURE"]
  CheckInAPI --> EventAttendance
  EventAttendance --> Monitor
  EventAttendance --> Confirm
  ManagedEvent -.->|optional link| CalendarEvent
  CalendarEvent -->|RSVP only| CalendarEventAttendance
```

---

## 2. Business door flow

![Business door flow](attendance-flowcharts/02-business-door-flow.png)

**Source:** Architecture §2

```mermaid
flowchart TD
  A[NFC TAP / QR SCAN] --> B[TAP verification]
  B --> C[Member verification]
  C --> D[Event verification]
  D --> E[Eligibility verification]
  E --> F[Attendance recorded]
  F --> G[Organizer / staff can monitor attendance]
```

---

## 5. Event lifecycle

![Event lifecycle](attendance-flowcharts/05-event-lifecycle.png)

**Source:** Architecture §8

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> PUBLISHED: Publish
  PUBLISHED --> LIVE: now in starts_at..ends_at
  PUBLISHED --> CANCELLED: Admin cancel
  LIVE --> ENDED: now greater than ends_at
  LIVE --> CANCELLED: Admin cancel
  ENDED --> ARCHIVED: Admin archive
  CANCELLED --> ARCHIVED: Admin archive
  PUBLISHED --> ARCHIVED: Admin archive
```

---

## 6. Event creation

![Event creation](attendance-flowcharts/06-event-creation.png)

**Source:** Architecture §9, §35.2

```mermaid
flowchart TD
  A[Company Admin / Manager] --> B[Create ManagedEvent]
  B --> C[Enter name / time / place / capacity]
  C --> D[Configure attendance settings]
  D --> E[Configure eligibility]
  E --> F{Save}
  F --> G[DRAFT]
  G --> H{Publish?}
  H -->|No| G
  H -->|Yes| I[PUBLISHED]
  I --> J[Visible to eligible members]
```

---

## 7. Member event journey

![Member event journey](attendance-flowcharts/07-member-event-journey.png)

**Source:** Architecture §10, §35.3

```mermaid
flowchart TD
  U[User] --> V[View event details]
  V --> E{Eligible?}
  E -->|No| X[Show not eligible]
  E -->|Yes| R{Registration required?}
  R -->|Yes| REG[Register]
  R -->|No| W[Wait for event day]
  REG --> W
  W --> ARRIVE[Arrive at venue]
  ARRIVE --> SCAN[NFC / QR / staff manual]
  SCAN --> OK{Check-in OK?}
  OK -->|Yes| C[Attendance confirmed]
  OK -->|No| ERR[Show one clear reason]
```

---

## 11. Attendance validation

![Attendance validation](attendance-flowcharts/11-attendance-validation.png)

**Source:** Architecture §14, §35.6, Whole Flow

```mermaid
flowchart TD
  Arrive[Member arrives] --> CapMethod{Capture method}
  CapMethod -->|NFC / QR / Manual| Online{Network online?}
  Online -->|No| OfflineRej[MVP REJECT: require online]
  Online -->|Yes| API[Check-in API]
  API --> AuthZ{Operator / booth authorized?}
  AuthZ -->|No| ErrAuth[REJECT unauthorized]
  AuthZ -->|Yes| VMember{Member / BizCard valid?}
  VMember -->|No| ErrMember[REJECT invalid member]
  VMember -->|Yes| VEvent{Event exists and LIVE / check-in open?}
  VEvent -->|No| ErrEvent[REJECT EVENT_NOT_LIVE]
  VEvent -->|Yes| VElig{eligibilityService.canAttend?}
  VElig -->|No| ErrElig[REJECT NOT_ELIGIBLE]
  VElig -->|Yes| VDup{Already EventAttendance row?}
  VDup -->|Yes| Idempotent[ALREADY_CHECKED_IN idempotent OK]
  VDup -->|No| VCap{Capacity OK?}
  VCap -->|No| ErrFull[EVENT_FULL unless audited override]
  VCap -->|Yes| Write[CREATE EventAttendance CHECKED_IN]
```

---

## 12. Duplicate prevention

![Duplicate check-in prevention](attendance-flowcharts/12-duplicate-prevention.png)

**Source:** Architecture §§15, 28, §35.7

```mermaid
flowchart TD
  S1[First scan] --> C[Insert EventAttendance]
  C --> OK[CHECK-IN SUCCESS]
  S2[Second scan] --> F[Find existing unique row]
  F --> ALREADY[ALREADY CHECKED IN]
  ALREADY --> NOWRITE[No second row]
```

---

## 27. End-to-end whole flow

![End-to-end whole flow](attendance-flowcharts/27-end-to-end-whole-flow.png)

**Source:** Architecture §35.17, Whole Flow

```mermaid
flowchart TD
  ORG[Organization / Company] --> CREATE[Create ManagedEvent]
  CREATE --> CFG[Configure attendance + eligibility]
  CFG --> PUB[Publish]
  PUB --> SEE[Member sees event]
  SEE --> ELIG[Membership / employee eligibility]
  ELIG --> REG[Registration / RSVP if required]
  REG --> DAY[Event day]
  DAY --> ARRIVE[Member arrives]
  ARRIVE --> CAPTURE[NFC / QR / Manual]
  CAPTURE --> API[TAP verification API]
  API --> V1[Validate member]
  V1 --> V2[Validate membership / employee]
  V2 --> V3[Validate event window]
  V3 --> V4[Validate eligibility]
  V4 --> V5[Check duplicate]
  V5 --> V6[Check capacity]
  V6 --> APPR[APPROVE]
  APPR --> REC[Create EventAttendance]
  REC --> CONF[Member confirmation]
  REC --> MON[Staff dashboard updates via poll]
  MON --> END[Event ends]
  END --> REP[Attendance report / export]
```

---

*Architecture source of truth: [`Attendance & Event Monitoring.md`](Attendance%20&%20Event%20Monitoring.md).*
