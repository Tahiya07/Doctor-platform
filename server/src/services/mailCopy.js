import { num } from "./language.js";

/**
 * The wording of every email the website sends to a person, in English and in Bengali.
 * Each entry turns the details into `{ subject, text }`. Names, links, codes and anything a person
 * typed are put in as they are. To change a sentence, change it in BOTH languages.
 */
const SIGN = {
  en: "\n\nCarewell\nThis is an automated message. Please do not reply.",
  bn: "\n\nকেয়ারওয়েল\nএটি একটি স্বয়ংক্রিয় বার্তা। অনুগ্রহ করে এর উত্তর দেবেন না।",
};

const NOTE = {
  en: (note) => (note ? `\n\nMessage from the administration:\n${note}` : ""),
  bn: (note) => (note ? `\n\nপ্রশাসনের বার্তা:\n${note}` : ""),
};

export const COPY = {
  en: {
    verification: ({ name, code, minutes }) => ({
      subject: `${code} is your Carewell verification code`,
      text:
        `Hello ${name},\n\nYour Carewell verification code is: ${code}\n\n` +
        `It expires in ${minutes} minutes. If you did not create a Carewell account, you can ignore this email.${SIGN.en}`,
    }),
    passwordReset: ({ name, link, minutes }) => ({
      subject: "Reset your Carewell password",
      text:
        `Hello ${name},\n\nWe received a request to reset your Carewell password. Open this link to choose a new one:\n\n${link}\n\n` +
        `The link works once and expires in ${minutes} minutes. If you did not ask for this, you can ignore this email; your password stays the same.${SIGN.en}`,
    }),
    invitation: ({ name, link, hours }) => ({
      subject: "You are invited to join Carewell",
      text:
        `Hello ${name},\n\nThe Carewell administration has added you as a doctor. Open this link to choose your password:\n\n${link}\n\n` +
        `The link works once and expires in ${hours} hours. After that, complete your profile and upload your BMDC registration certificate; ` +
        `the administration checks it with the BMDC register before your profile is published.\n\n` +
        `If you were not expecting this, you can ignore this email.${SIGN.en}`,
    }),
    applicationReceived: ({ name }) => ({
      subject: "We received your Carewell application",
      text:
        `Hello ${name},\n\nThank you for applying to Carewell. The administration will check your BMDC registration certificate ` +
        `with the BMDC register and review your profile. We will email you when there is a decision.${SIGN.en}`,
    }),
    newApplication: ({ doctorName, link }) => ({
      subject: `[Carewell] New doctor application: ${doctorName}`,
      text:
        `${doctorName} submitted an application to join Carewell.\n\n` +
        `Check the BMDC certificate against the BMDC register and decide in the administrator area:\n${link}`,
    }),
    decision: ({ name, decision, note, reapplyDate, link }) => {
      const body = {
        approved:
          `The administration checked your BMDC registration and approved your application. Your workspace is now open; ` +
          `your profile becomes visible to patients once it is published.${NOTE.en(note)}`,
        changes_requested: `The administration asked for changes before it can approve your application.${NOTE.en(note)}\n\nSign in, make the changes and submit again.`,
        rejected: `The administration could not approve your application.${NOTE.en(note)}\n\nYou can apply again from ${reapplyDate}.`,
      }[decision];
      const subject = {
        approved: "Your Carewell application was approved",
        changes_requested: "Your Carewell application needs changes",
        rejected: "Your Carewell application was not approved",
      }[decision];
      return { subject, text: `Hello ${name},\n\n${body}\n\n${link}${SIGN.en}` };
    },
    profilePublished: ({ name, link }) => ({
      subject: "Your Carewell profile is live",
      text: `Hello ${name},\n\nYour profile is now visible on Carewell. Patients can find you and request appointments.\n\n${link}${SIGN.en}`,
    }),
    supportReply: ({ name, message, original }) => ({
      subject: "Your message to Carewell",
      text: `Hello${name ? ` ${name}` : ""},\n\n${message}\n\n— Carewell support\n\nYour message was:\n${original}`,
    }),
    // ── Appointments ────────────────────────────────────────────────────────────────────────
    appointmentRequested: ({ name, doctor, when, facility, link }) => ({
      subject: "We received your appointment request",
      text:
        `Hello ${name},\n\nYour request to ${doctor} for ${when} at ${facility} is waiting for the doctor's answer. ` +
        `We will email you as soon as they reply.\n\n${link}${SIGN.en}`,
    }),
    appointmentAccepted: ({ name, doctor, when, facility, link }) => ({
      subject: "Your appointment was accepted",
      text: `Hello ${name},\n\n${doctor} accepted your request for ${when} at ${facility}. You can now message the doctor.\n\n${link}${SIGN.en}`,
    }),
    appointmentRejected: ({ name, doctor, when, link }) => ({
      subject: "Your appointment request was not accepted",
      text: `Hello ${name},\n\n${doctor} could not accept your request for ${when}. You can choose another time.\n\n${link}${SIGN.en}`,
    }),
    appointmentCancelled: ({ name, doctor, when, byAdmin, link }) => ({
      subject: "Your appointment was cancelled",
      text: `Hello ${name},\n\nYour appointment with ${doctor} on ${when} was cancelled${byAdmin ? " by the administration" : ""}.\n\n${link}${SIGN.en}`,
    }),
    doctorNewRequest: ({ name, patient, forOther, when, link }) => ({
      subject: "New appointment request",
      text:
        `Hello ${name},\n\n${patient}${forOther ? " (booking for someone else)" : ""} asked for ${when}. ` +
        `Open Carewell to read the details and answer.\n\n${link}${SIGN.en}`,
    }),
    doctorPatientCancelled: ({ name, patient, when, link }) => ({
      subject: "An appointment was cancelled by the patient",
      text: `Hello ${name},\n\n${patient} cancelled the appointment on ${when}.\n\n${link}${SIGN.en}`,
    }),
    // ── Security ────────────────────────────────────────────────────────────────────────────
    accountLocked: ({ name, attempts, minutes, ip, link }) => ({
      subject: "Your Carewell administrator account is locked",
      text:
        `Hello ${name},\n\nThere were ${attempts} wrong password attempts on your administrator account (from ${ip}), so it is locked for ${minutes} minutes.\n\n` +
        `If this was you, wait and try again, or reset your password to unlock it now:\n${link}\n\n` +
        `If it was not you, reset your password anyway and tell the other administrators.${SIGN.en}`,
    }),
  },

  bn: {
    verification: ({ name, code, minutes }) => ({
      subject: `${code} আপনার কেয়ারওয়েল যাচাইকরণ কোড`,
      text:
        `প্রিয় ${name},\n\nআপনার কেয়ারওয়েল যাচাইকরণ কোড: ${code}\n\n` +
        `কোডটি ${num("bn", minutes)} মিনিট পর্যন্ত কার্যকর থাকবে। আপনি কেয়ারওয়েলে অ্যাকাউন্ট না খুলে থাকলে এই ইমেইলটি উপেক্ষা করুন।${SIGN.bn}`,
    }),
    passwordReset: ({ name, link, minutes }) => ({
      subject: "আপনার কেয়ারওয়েল পাসওয়ার্ড রিসেট করুন",
      text:
        `প্রিয় ${name},\n\nআমরা আপনার কেয়ারওয়েল পাসওয়ার্ড রিসেট করার অনুরোধ পেয়েছি। নতুন পাসওয়ার্ড বেছে নিতে এই লিংকটি খুলুন:\n\n${link}\n\n` +
        `লিংকটি একবারই কাজ করবে এবং ${num("bn", minutes)} মিনিট পর মেয়াদ শেষ হবে। আপনি এই অনুরোধ না করে থাকলে ইমেইলটি উপেক্ষা করুন; আপনার পাসওয়ার্ড আগের মতোই থাকবে।${SIGN.bn}`,
    }),
    invitation: ({ name, link, hours }) => ({
      subject: "কেয়ারওয়েলে যোগ দিতে আপনাকে আমন্ত্রণ জানানো হয়েছে",
      text:
        `প্রিয় ${name},\n\nকেয়ারওয়েল প্রশাসন আপনাকে ডাক্তার হিসেবে যুক্ত করেছে। পাসওয়ার্ড বেছে নিতে এই লিংকটি খুলুন:\n\n${link}\n\n` +
        `লিংকটি একবারই কাজ করবে এবং ${num("bn", hours)} ঘণ্টা পর মেয়াদ শেষ হবে। এরপর আপনার প্রোফাইল সম্পূর্ণ করুন এবং বিএমডিসি নিবন্ধন সনদ আপলোড করুন; ` +
        `প্রোফাইল প্রকাশের আগে প্রশাসন তা বিএমডিসির নিবন্ধনের সঙ্গে মিলিয়ে দেখবে।\n\n` +
        `আপনি এটি আশা না করে থাকলে ইমেইলটি উপেক্ষা করুন।${SIGN.bn}`,
    }),
    applicationReceived: ({ name }) => ({
      subject: "আমরা আপনার কেয়ারওয়েল আবেদন পেয়েছি",
      text:
        `প্রিয় ${name},\n\nকেয়ারওয়েলে আবেদন করার জন্য ধন্যবাদ। প্রশাসন আপনার বিএমডিসি নিবন্ধন সনদ বিএমডিসির নিবন্ধনের সঙ্গে মিলিয়ে দেখবে এবং আপনার প্রোফাইল পর্যালোচনা করবে। ` +
        `সিদ্ধান্ত হলে আমরা ইমেইলে জানাব।${SIGN.bn}`,
    }),
    newApplication: ({ doctorName, link }) => ({
      subject: `[কেয়ারওয়েল] নতুন ডাক্তারের আবেদন: ${doctorName}`,
      text:
        `${doctorName} কেয়ারওয়েলে যোগ দিতে আবেদন করেছেন।\n\n` +
        `বিএমডিসি সনদটি বিএমডিসির নিবন্ধনের সঙ্গে মিলিয়ে দেখে প্রশাসন এলাকায় সিদ্ধান্ত নিন:\n${link}`,
    }),
    decision: ({ name, decision, note, reapplyDate, link }) => {
      const body = {
        approved:
          `প্রশাসন আপনার বিএমডিসি নিবন্ধন যাচাই করে আবেদনটি অনুমোদন করেছে। আপনার কর্মক্ষেত্র এখন খোলা; ` +
          `প্রোফাইল প্রকাশিত হলে রোগীরা তা দেখতে পাবেন।${NOTE.bn(note)}`,
        changes_requested: `আবেদনটি অনুমোদনের আগে প্রশাসন কিছু পরিবর্তন চেয়েছে।${NOTE.bn(note)}\n\nসাইন ইন করে পরিবর্তনগুলো করুন এবং আবার জমা দিন।`,
        rejected: `প্রশাসন আপনার আবেদনটি অনুমোদন করতে পারেনি।${NOTE.bn(note)}\n\nআপনি ${reapplyDate} থেকে আবার আবেদন করতে পারবেন।`,
      }[decision];
      const subject = {
        approved: "আপনার কেয়ারওয়েল আবেদন অনুমোদিত হয়েছে",
        changes_requested: "আপনার কেয়ারওয়েল আবেদনে কিছু পরিবর্তন দরকার",
        rejected: "আপনার কেয়ারওয়েল আবেদন অনুমোদিত হয়নি",
      }[decision];
      return { subject, text: `প্রিয় ${name},\n\n${body}\n\n${link}${SIGN.bn}` };
    },
    profilePublished: ({ name, link }) => ({
      subject: "আপনার কেয়ারওয়েল প্রোফাইল এখন লাইভ",
      text: `প্রিয় ${name},\n\nআপনার প্রোফাইল এখন কেয়ারওয়েলে দেখা যাচ্ছে। রোগীরা আপনাকে খুঁজে পেয়ে অ্যাপয়েন্টমেন্টের অনুরোধ করতে পারবেন।\n\n${link}${SIGN.bn}`,
    }),
    supportReply: ({ name, message, original }) => ({
      subject: "কেয়ারওয়েলে পাঠানো আপনার বার্তার উত্তর",
      text: `প্রিয়${name ? ` ${name}` : ""},\n\n${message}\n\n— কেয়ারওয়েল সহায়তা\n\nআপনার বার্তাটি ছিল:\n${original}`,
    }),
    // ── Appointments ────────────────────────────────────────────────────────────────────────
    appointmentRequested: ({ name, doctor, when, facility, link }) => ({
      subject: "আমরা আপনার অ্যাপয়েন্টমেন্টের অনুরোধ পেয়েছি",
      text:
        `প্রিয় ${name},\n\n${doctor}-এর কাছে ${when}, ${facility}-এর জন্য পাঠানো আপনার অনুরোধ ডাক্তারের উত্তরের অপেক্ষায় আছে। ` +
        `তিনি উত্তর দিলেই আমরা ইমেইলে জানাব।\n\n${link}${SIGN.bn}`,
    }),
    appointmentAccepted: ({ name, doctor, when, facility, link }) => ({
      subject: "আপনার অ্যাপয়েন্টমেন্ট গ্রহণ করা হয়েছে",
      text: `প্রিয় ${name},\n\n${doctor} ${when}, ${facility}-এর জন্য আপনার অনুরোধ গ্রহণ করেছেন। এখন আপনি ডাক্তারকে বার্তা পাঠাতে পারেন।\n\n${link}${SIGN.bn}`,
    }),
    appointmentRejected: ({ name, doctor, when, link }) => ({
      subject: "আপনার অ্যাপয়েন্টমেন্টের অনুরোধ গ্রহণ করা হয়নি",
      text: `প্রিয় ${name},\n\n${doctor} ${when}-এর জন্য আপনার অনুরোধ গ্রহণ করতে পারেননি। আপনি অন্য একটি সময় বেছে নিতে পারেন।\n\n${link}${SIGN.bn}`,
    }),
    appointmentCancelled: ({ name, doctor, when, byAdmin, link }) => ({
      subject: "আপনার অ্যাপয়েন্টমেন্ট বাতিল হয়েছে",
      text: `প্রিয় ${name},\n\n${doctor}-এর সঙ্গে ${when}-এর আপনার অ্যাপয়েন্টমেন্ট${byAdmin ? " প্রশাসনের পক্ষ থেকে" : ""} বাতিল করা হয়েছে।\n\n${link}${SIGN.bn}`,
    }),
    doctorNewRequest: ({ name, patient, forOther, when, link }) => ({
      subject: "নতুন অ্যাপয়েন্টমেন্টের অনুরোধ",
      text:
        `প্রিয় ${name},\n\n${patient}${forOther ? " (অন্য একজনের জন্য)" : ""} ${when}-এর জন্য অনুরোধ করেছেন। ` +
        `বিস্তারিত পড়তে ও উত্তর দিতে কেয়ারওয়েল খুলুন।\n\n${link}${SIGN.bn}`,
    }),
    doctorPatientCancelled: ({ name, patient, when, link }) => ({
      subject: "রোগী একটি অ্যাপয়েন্টমেন্ট বাতিল করেছেন",
      text: `প্রিয় ${name},\n\n${patient} ${when}-এর অ্যাপয়েন্টমেন্টটি বাতিল করেছেন।\n\n${link}${SIGN.bn}`,
    }),
    // ── Security ────────────────────────────────────────────────────────────────────────────
    accountLocked: ({ name, attempts, minutes, ip, link }) => ({
      subject: "আপনার কেয়ারওয়েল অ্যাডমিন অ্যাকাউন্ট লক হয়েছে",
      text:
        `প্রিয় ${name},\n\nআপনার অ্যাডমিন অ্যাকাউন্টে (${ip} থেকে) ${num("bn", attempts)}বার ভুল পাসওয়ার্ড দেওয়া হয়েছে, তাই এটি ${num("bn", minutes)} মিনিটের জন্য লক করা হয়েছে।\n\n` +
        `এটি আপনি করে থাকলে অপেক্ষা করে আবার চেষ্টা করুন, অথবা এখনই খুলতে পাসওয়ার্ড রিসেট করুন:\n${link}\n\n` +
        `আপনি না করে থাকলে তবুও পাসওয়ার্ড রিসেট করুন এবং অন্য অ্যাডমিনদের জানান।${SIGN.bn}`,
    }),
  },
};
