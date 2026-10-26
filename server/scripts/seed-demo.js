import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/services/auth.js";
import { notify } from "../src/services/notifications.js";
import { addDays, dhakaNow, toDbDate, toDbTime } from "../src/utils/time.js";
import { applyRenames, doctorImage, FACILITY_IMAGES } from "./images.js";

// Fills the database with realistic (but entirely fictional) data so every screen has something to show:
// specialties, clinics and hospitals, verified and published doctors with open appointment times,
// patients with appointment requests in every status, conversations and a few support requests.
//
// Safe to run more than once: it only creates what is missing. Run it after `npm run seed`.
//
//   SEED_DEMO_PASSWORD  (required, at least 10 characters; set it in the root .env.local)
//                       Every demo doctor and patient signs in with this password.

const password = process.env.SEED_DEMO_PASSWORD ?? "";
if (password.length < 10) {
  console.error("Set SEED_DEMO_PASSWORD (10+ characters) in the root .env.local first.");
  process.exit(1);
}

const SPECIALTIES = [
  { id: "orthopedics", name: "Orthopedics", description: "Bones, joints & sports injuries" },
  { id: "ophthalmology", name: "Ophthalmology", description: "Eye care & vision" },
  { id: "ent", name: "ENT", description: "Ear, nose & throat" },
  { id: "psychiatry", name: "Psychiatry", description: "Mental health & counselling" },
  { id: "gastroenterology", name: "Gastroenterology", description: "Digestive system & liver" },
  { id: "endocrinology", name: "Endocrinology", description: "Diabetes, thyroid & hormones" },
  { id: "urology", name: "Urology", description: "Urinary tract & kidney care" },
  { id: "pulmonology", name: "Pulmonology", description: "Lungs & breathing" },
  { id: "general-medicine", name: "General Medicine", description: "Family & general medical care" },
];

const FACILITIES = [
  {
    name: "Dhanmondi Family Health Clinic",
    type: "clinic",
    address: "House 42, Road 8A",
    area: "Dhanmondi",
    city: "Dhaka",
    phone: "+880 2 5811 3300",
    openingHours: "9:00 AM–9:00 PM",
  },
  {
    name: "Uttara Community Hospital",
    type: "hospital",
    address: "Sector 7, Road 12",
    area: "Uttara",
    city: "Dhaka",
    phone: "+880 2 8991 2400",
    openingHours: "Open 24 hours",
  },
  {
    name: "Mirpur Care Clinic",
    type: "clinic",
    address: "Block C, Road 3, Section 10",
    area: "Mirpur",
    city: "Dhaka",
    phone: "+880 2 9001 7788",
    openingHours: "10:00 AM–8:00 PM",
  },
  {
    name: "Bashundhara Medical Institute",
    type: "hospital",
    address: "Block D, Road 5",
    area: "Bashundhara",
    city: "Dhaka",
    phone: "+880 2 8402 6100",
    openingHours: "Open 24 hours",
  },
  {
    name: "Mohammadpur Child & Women Clinic",
    type: "clinic",
    address: "Town Hall Road, House 15",
    area: "Mohammadpur",
    city: "Dhaka",
    phone: "+880 2 9120 4455",
    openingHours: "9:00 AM–7:00 PM",
  },
  {
    name: "Motijheel Diagnostic & Consultation Centre",
    type: "clinic",
    address: "Level 4, Dilkusha C/A",
    area: "Motijheel",
    city: "Dhaka",
    phone: "+880 2 9558 2100",
    openingHours: "8:30 AM–6:30 PM",
  },
  {
    name: "Agrabad Specialist Clinic",
    type: "clinic",
    address: "CDA Avenue, Agrabad C/A",
    area: "Agrabad",
    city: "Chattogram",
    phone: "+880 31 251 7700",
    openingHours: "9:00 AM–8:00 PM",
  },
  {
    name: "Zindabazar Health Centre",
    type: "clinic",
    address: "Zindabazar Point, Ground floor",
    area: "Zindabazar",
    city: "Sylhet",
    phone: "+880 821 71 5500",
    openingHours: "9:00 AM–6:00 PM",
  },
];

const CMC = "Carewell Medical Centre";
const LAKE = "Lakeside Specialist Hospital";
const GREEN = "Greenline Family Clinic";

// [name, email, specialty, qualifications, years, fee (BDT), area, clinics (first one is the main one), phone]
// Years of experience follow the doctor's age in the photo (an MBBS finishes at about 24) and the degrees they hold:
// an MD or FCPS takes about 4 more years, so nobody young has a long career or a degree they could not have finished.
const DOCTORS = [
  [
    "Dr. Nusrat Karim",
    "nusrat.karim",
    "cardiology",
    ["MBBS", "MD (Cardiology)", "FACC"],
    24,
    1500,
    "Dhanmondi",
    [CMC, LAKE],
    "+880 1711 200001",
  ],
  [
    "Dr. Tanvir Hossain",
    "tanvir.hossain",
    "cardiology",
    ["MBBS", "FCPS (Medicine)"],
    8,
    1200,
    "Gulshan",
    [LAKE, "Bashundhara Medical Institute"],
    "+880 1711 200002",
  ],
  [
    "Dr. Farzana Haque",
    "farzana.haque",
    "dermatology",
    ["MBBS", "DDV", "MD (Dermatology)"],
    13,
    1000,
    "Banani",
    [GREEN],
    "+880 1711 200003",
  ],
  [
    "Dr. Imran Chowdhury",
    "imran.chowdhury",
    "dermatology",
    ["MBBS", "DDV"],
    6,
    900,
    "Uttara",
    ["Uttara Community Hospital"],
    "+880 1711 200004",
  ],
  [
    "Dr. Shirin Akter",
    "shirin.akter",
    "pediatrics",
    ["MBBS", "DCH", "FCPS (Pediatrics)"],
    15,
    800,
    "Mohammadpur",
    ["Mohammadpur Child & Women Clinic", CMC],
    "+880 1711 200005",
  ],
  [
    "Dr. Rakibul Islam",
    "rakibul.islam",
    "pediatrics",
    ["MBBS", "DCH"],
    3,
    600,
    "Mirpur",
    ["Mirpur Care Clinic"],
    "+880 1711 200006",
  ],
  [
    "Dr. Sadia Rahman",
    "sadia.rahman",
    "dentistry",
    ["BDS", "Diploma in Orthodontics"],
    3,
    600,
    "Dhanmondi",
    ["Dhanmondi Family Health Clinic"],
    "+880 1711 200007",
  ],
  [
    "Dr. Arman Siddique",
    "arman.siddique",
    "neurology",
    ["MBBS", "MD (Neurology)", "MRCP"],
    10,
    1500,
    "Bashundhara",
    ["Bashundhara Medical Institute", LAKE],
    "+880 1711 200008",
  ],
  [
    "Dr. Mehnaz Sultana",
    "mehnaz.sultana",
    "gynecology",
    ["MBBS", "DGO"],
    4,
    900,
    "Banani",
    [GREEN, LAKE],
    "+880 1711 200009",
  ],
  [
    "Dr. Zahid Anwar",
    "zahid.anwar",
    "orthopedics",
    ["MBBS", "MS (Orthopedics)"],
    13,
    1400,
    "Motijheel",
    ["Motijheel Diagnostic & Consultation Centre"],
    "+880 1711 200010",
  ],
  [
    "Dr. Lamia Parvin",
    "lamia.parvin",
    "ophthalmology",
    ["MBBS", "DO", "FCPS (Ophthalmology)"],
    9,
    900,
    "Uttara",
    ["Uttara Community Hospital"],
    "+880 1711 200011",
  ],
  [
    "Dr. Habibur Rahman",
    "habibur.rahman",
    "ent",
    ["MBBS", "MS (ENT)"],
    21,
    1100,
    "Mirpur",
    ["Mirpur Care Clinic", CMC],
    "+880 1711 200012",
  ],
  [
    "Dr. Anika Tabassum",
    "anika.tabassum",
    "psychiatry",
    ["MBBS", "MPhil (Psychiatry)"],
    4,
    900,
    "Gulshan",
    [LAKE],
    "+880 1711 200013",
  ],
  [
    "Dr. Kamrul Hasan",
    "kamrul.hasan",
    "gastroenterology",
    ["MBBS", "MD (Gastroenterology)"],
    14,
    1600,
    "Dhanmondi",
    [CMC, "Dhanmondi Family Health Clinic"],
    "+880 1711 200014",
  ],
  [
    "Dr. Rubel Yasin",
    "rubel.yasin",
    "endocrinology",
    ["MBBS", "MD (Endocrinology)", "Diploma in Diabetology"],
    8,
    1100,
    "Agrabad",
    ["Agrabad Specialist Clinic"],
    "+880 1711 200015",
  ],
  [
    "Dr. Mahbub Alam",
    "mahbub.alam",
    "general-medicine",
    ["MBBS"],
    2,
    500,
    "Zindabazar",
    ["Zindabazar Health Centre"],
    "+880 1711 200016",
  ],
];

const PATIENTS = [
  ["Ayesha Siddika", "ayesha.siddika", "+880 1711 100001"],
  ["Rafiq Ahmed", "rafiq.ahmed", "+880 1711 100002"],
  ["Tasnim Jahan", "tasnim.jahan", "+880 1711 100003"],
  ["Imtiaz Kabir", "imtiaz.kabir", "+880 1711 100004"],
];

const SUPPORT = [
  {
    message:
      "I booked an appointment for my mother but I cannot see it under My appointments. Could you check?",
    email: "ayesha.siddika@carewell.test",
  },
  {
    message:
      "Is it possible to add a new clinic in Rajshahi to the platform? Our hospital would like to be listed.",
    email: "info@rajshahi-care.example",
  },
];

// ── helpers ────────────────────────────────────────────────────────────────────────────────
const today = dhakaNow().date;
const isFriday = (dateKey) => new Date(`${dateKey}T12:00:00Z`).getUTCDay() === 5;
const hhmm = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const stats = {};
const count = (key, n = 1) => (stats[key] = (stats[key] ?? 0) + n);

async function main() {
  const passwordHash = await hashPassword(password);

  // specialties
  for (const specialty of SPECIALTIES) {
    const exists = await prisma.specialty.findUnique({ where: { id: specialty.id } });
    if (!exists) {
      await prisma.specialty.create({ data: specialty });
      count("specialties created");
    }
  }

  // clinics and hospitals
  const clinics = new Map((await prisma.clinic.findMany()).map((c) => [c.name, c]));
  for (const facility of FACILITIES) {
    if (clinics.has(facility.name)) continue;
    clinics.set(
      facility.name,
      await prisma.clinic.create({ data: { ...facility, image: FACILITY_IMAGES[facility.name] } }),
    );
    count("facilities created");
  }

  // doctors: account, verified + published profile, clinics, administration thread
  await applyRenames(prisma); // an earlier version of the demo data used a different name for one doctor
  const doctors = [];
  for (const [
    name,
    local,
    specialtyId,
    qualifications,
    experienceYears,
    fee,
    location,
    clinicNames,
    phone,
  ] of DOCTORS) {
    const email = `${local}@carewell.test`;
    let user = await prisma.user.findUnique({ where: { email }, include: { doctor: true } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          name,
          email,
          phone,
          passwordHash,
          role: "doctor",
          emailVerifiedAt: new Date(),
          doctor: {
            create: {
              specialtyId,
              qualifications,
              experienceYears,
              fee,
              location,
              image: doctorImage(local),
              verificationStatus: "verified",
              onboardingStatus: "approved",
              publicationStatus: "published",
              clinics: { create: clinicNames.map((n) => ({ clinicId: clinics.get(n).id })) },
            },
          },
        },
        include: { doctor: true },
      });
      count("doctors created");
    }
    const doctorId = user.doctor.id;
    const hasThread = await prisma.conversation.findFirst({ where: { kind: "doctor_admin", doctorId } });
    if (!hasThread) await prisma.conversation.create({ data: { kind: "doctor_admin", doctorId } });
    doctors.push({
      name,
      email,
      userId: user.id,
      id: doctorId,
      clinicIds: clinicNames.map((n) => clinics.get(n).id),
      local,
    });
  }
  const doctorByEmail = (local) => doctors.find((d) => d.local === local);

  // open appointment times: the next two weeks, 5 half-hour slots a day, Fridays off
  let slotRows = [];
  for (const [index, doctor] of doctors.entries()) {
    const startMinutes = (9 + (index % 4) * 2) * 60;
    for (let offset = 1; offset <= 14; offset += 1) {
      const date = addDays(today, offset);
      if (isFriday(date)) continue;
      const clinicId = doctor.clinicIds[offset % doctor.clinicIds.length];
      for (let n = 0; n < 5; n += 1)
        slotRows.push({
          doctorId: doctor.id,
          clinicId,
          date: toDbDate(date),
          startTime: toDbTime(hhmm(startMinutes + n * 30)),
          endTime: toDbTime(hhmm(startMinutes + n * 30 + 25)),
        });
    }
  }
  const created = await prisma.availabilitySlot.createMany({ data: slotRows, skipDuplicates: true });
  count("open times created", created.count);

  // patients
  const patients = [];
  for (const [name, local, phone] of PATIENTS) {
    const email = `${local}@carewell.test`;
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: { name, email, phone, passwordHash, role: "patient", emailVerifiedAt: new Date() },
      });
      count("patients created");
    }
    patients.push({ ...user, local });
  }
  const patient = (local) => patients.find((p) => p.local === local);

  // appointment requests in every status (a "past" one needs its own earlier slot)
  async function slotFor(doctor, { past = false, nth = 0 }) {
    if (!past) {
      const rows = await prisma.availabilitySlot.findMany({
        where: { doctorId: doctor.id, date: { gte: toDbDate(addDays(today, 1)) } },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        take: 12,
      });
      return rows[nth];
    }
    const date = toDbDate(addDays(today, -3 - nth));
    const clinicId = doctor.clinicIds[0];
    const start = toDbTime(`${String(8 + nth).padStart(2, "0")}:00`);
    return (
      (await prisma.availabilitySlot.findFirst({
        where: { doctorId: doctor.id, clinicId, date, startTime: start },
      })) ??
      prisma.availabilitySlot.create({
        data: {
          doctorId: doctor.id,
          clinicId,
          date,
          startTime: start,
          endTime: toDbTime(`${String(8 + nth).padStart(2, "0")}:25`),
        },
      })
    );
  }

  const PLAN = [
    // patient, doctor, status, extra { relationship, who, reason, past, nth }
    [
      "ayesha.siddika",
      "nusrat.karim",
      "accepted",
      { reason: "Chest tightness when climbing stairs, follow-up ECG", nth: 0 },
    ],
    [
      "ayesha.siddika",
      "shirin.akter",
      "pending",
      {
        relationship: "child",
        who: "Rayan Siddika",
        reason: "Persistent cough and mild fever for three days",
        nth: 1,
      },
    ],
    ["ayesha.siddika", "sadia.rahman", "completed", { reason: "Dental check-up and cleaning", past: true }],
    [
      "rafiq.ahmed",
      "tanvir.hossain",
      "accepted",
      { reason: "High blood pressure review and medication adjustment", nth: 0 },
    ],
    ["rafiq.ahmed", "farzana.haque", "pending", { reason: "Recurring skin rash on both arms", nth: 2 }],
    ["tasnim.jahan", "mehnaz.sultana", "accepted", { reason: "Routine antenatal check-up", nth: 1 }],
    [
      "tasnim.jahan",
      "kamrul.hasan",
      "completed",
      { reason: "Acidity and stomach pain after meals", past: true },
    ],
    ["imtiaz.kabir", "zahid.anwar", "rejected", { reason: "Knee pain after running", nth: 3 }],
    [
      "imtiaz.kabir",
      "arman.siddique",
      "cancelled",
      { relationship: "parent", who: "Abdul Kabir", reason: "Frequent headaches and dizziness", nth: 2 },
    ],
  ];
  const newlyCreated = [];
  for (const [patientKey, doctorKey, status, extra] of PLAN) {
    const p = patient(patientKey);
    const d = doctorByEmail(doctorKey);
    const slot = await slotFor(d, extra);
    if (!slot) continue;
    const exists = await prisma.appointment.findFirst({ where: { patientId: p.id, slotId: slot.id } });
    if (exists) continue;
    const appointment = await prisma.appointment.create({
      data: {
        patientId: p.id,
        slotId: slot.id,
        doctorId: d.id,
        clinicId: slot.clinicId,
        relationship: extra.relationship ?? "self",
        patientName: extra.who ?? p.name,
        phone: p.phone,
        email: p.email,
        reason: extra.reason,
        status,
      },
    });
    count(`appointments ${status}`);
    newlyCreated.push({ appointment, p, d, status });
  }

  // conversations (patient <-> doctor) with a short exchange for accepted and completed visits
  const TALK = {
    accepted: [
      ["patient", "Hello doctor, thank you for accepting my request. Should I bring my previous reports?"],
      [
        "doctor",
        "Yes please, bring your last test results and any current medicines. See you at the appointment.",
      ],
    ],
    completed: [
      ["patient", "Thank you for the consultation, doctor. I will follow the advice."],
      ["doctor", "You are welcome. Come back if the symptoms return."],
    ],
  };
  for (const { appointment, p, d, status } of newlyCreated) {
    if (!TALK[status]) continue;
    const conversation = await prisma.conversation.upsert({
      where: { doctorId_patientId: { doctorId: d.id, patientId: p.id } },
      update: {},
      create: { kind: "patient_doctor", doctorId: d.id, patientId: p.id },
    });
    if (await prisma.message.count({ where: { conversationId: conversation.id } })) continue;
    for (const [who, body] of TALK[status])
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: who === "patient" ? p.id : d.userId,
          body,
          readAt: status === "completed" ? new Date() : null,
        },
      });
    count("conversations with messages");
    void appointment;
  }

  // notifications for what just happened
  for (const { appointment, p, d, status } of newlyCreated) {
    if (status === "pending")
      await notify(d.userId, {
        kind: "appointment",
        title: "New appointment request",
        body: `${appointment.patientName} asked for an appointment: "${appointment.reason}"`,
        link: "/doctor/dashboard",
      });
    if (status === "accepted")
      await notify(p.id, {
        kind: "appointment",
        title: "Appointment accepted",
        body: `${d.name} accepted your request. You can now message the doctor.`,
        link: "/messages",
      });
    if (status === "rejected")
      await notify(p.id, {
        kind: "appointment",
        title: "Appointment not accepted",
        body: `${d.name} could not accept your request. You can choose another time.`,
        link: "/appointments",
      });
  }

  // support requests
  for (const request of SUPPORT) {
    if (await prisma.supportRequest.findFirst({ where: { message: request.message } })) continue;
    const user = await prisma.user.findUnique({ where: { email: request.email } });
    await prisma.supportRequest.create({ data: { ...request, userId: user?.id } });
    count("support requests");
  }
  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } });
  if (stats["support requests"])
    await notify(
      admins.map((a) => a.id),
      {
        kind: "support",
        title: "New support request",
        body: "Two new messages are waiting in the support inbox.",
        link: "/admin/support",
      },
    );

  console.log(
    Object.keys(stats).length ? "Created:" : "Nothing to create: the demo data is already in place.",
  );
  for (const [key, n] of Object.entries(stats)) console.log(`  ${n} ${key}`);
  console.log(
    `\nDemo doctors: ${DOCTORS.length}. Sign in as a doctor, e.g. ${DOCTORS[0][1]}@carewell.test, or as a patient, e.g. ${PATIENTS[0][1]}@carewell.test`,
  );
  console.log("All demo accounts use the password SEED_DEMO_PASSWORD from .env.local.");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
