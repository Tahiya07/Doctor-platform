import { BN } from "./bn.js";

const LOWER = new Map(Object.entries(BN).map(([key, value]) => [key.toLowerCase(), value]));

/**
 * English → Bengali for one piece of text. Returns the Bengali text, or null when there is nothing to translate
 * (a name, an email address, text that is already Bengali). Used by `t()` and by the page translator.
 *
 * Order: exact dictionary entry → numbers and times → date words → sentence patterns that contain names or counts.
 */
const DIGITS = "০১২৩৪৫৬৭৮৯";
export const bnDigits = (value) => String(value).replace(/\d/g, (digit) => DIGITS[digit]);

const WEEKDAYS = {
  Mon: "সোম",
  Tue: "মঙ্গল",
  Wed: "বুধ",
  Thu: "বৃহস্পতি",
  Fri: "শুক্র",
  Sat: "শনি",
  Sun: "রবি",
  Monday: "সোমবার",
  Tuesday: "মঙ্গলবার",
  Wednesday: "বুধবার",
  Thursday: "বৃহস্পতিবার",
  Friday: "শুক্রবার",
  Saturday: "শনিবার",
  Sunday: "রবিবার",
};
const MONTHS = {
  Jan: "জানুয়ারি",
  Feb: "ফেব্রুয়ারি",
  Mar: "মার্চ",
  Apr: "এপ্রিল",
  May: "মে",
  Jun: "জুন",
  Jul: "জুলাই",
  Aug: "আগস্ট",
  Sep: "সেপ্টেম্বর",
  Oct: "অক্টোবর",
  Nov: "নভেম্বর",
  Dec: "ডিসেম্বর",
  January: "জানুয়ারি",
  February: "ফেব্রুয়ারি",
  March: "মার্চ",
  April: "এপ্রিল",
  June: "জুন",
  July: "জুলাই",
  August: "আগস্ট",
  September: "সেপ্টেম্বর",
  October: "অক্টোবর",
  November: "নভেম্বর",
  December: "ডিসেম্বর",
};
const DAY_WORDS = { Today: "আজ", Tomorrow: "আগামীকাল", Yesterday: "গতকাল", Now: "এখন" };

/** "3:00 PM" → "বিকাল ৩:০০" (the part of the day people actually say). */
function timeBn(hour, minute, meridiem) {
  let h24 = Number(hour) % 12;
  if (/p/i.test(meridiem)) h24 += 12;
  const part =
    h24 < 4
      ? "রাত"
      : h24 < 12
        ? "সকাল"
        : h24 < 15
          ? "দুপুর"
          : h24 < 18
            ? "বিকাল"
            : h24 < 20
              ? "সন্ধ্যা"
              : "রাত";
  return `${part} ${hour}:${minute}`;
}

const normalise = (text) => text.replace(/\s+/g, " ").trim();

function numbersOnly(text) {
  if (!/^[\d\s.,:/\-–·৳%]+\+?$/.test(text) || !/\d/.test(text)) return null;
  if (text.replace(/\D/g, "").length > 8) return null; // a phone number or an id, not a count
  return bnDigits(text);
}

function dateWords(text) {
  const out = text
    .replace(/(\d{1,2}):(\d{2})\s?(AM|PM|am|pm)/g, (_m, h, m, ap) => timeBn(h, m, ap))
    .replace(/\b(Today|Tomorrow|Yesterday|Now)\b/g, (w) => DAY_WORDS[w])
    .replace(
      /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g,
      (w) => WEEKDAYS[w],
    )
    .replace(
      /\b(January|February|March|April|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g,
      (w) => MONTHS[w],
    );
  return out === text || /[A-Za-z]/.test(out) ? null : bnDigits(out);
}

// Sentences with a name, a count or a status inside. {1} = text as written, {t1} = translated, {d1} = Bengali digits.
const PATTERNS = [
  [/^(\d+) doctors?$/, "{d1} জন ডাক্তার"],
  // sentences the server sends (names stay as written; dates and times are converted)
  [
    /^(.+?) accepted your request for (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2} [AP]M) at (.+?)\. You can now message the doctor\.$/,
    "{1} {d2} তারিখে {t3}-এর জন্য আপনার অনুরোধ গ্রহণ করেছেন ({4})। এখন ডাক্তারকে বার্তা পাঠাতে পারেন।",
  ],
  [
    /^(.+?) accepted your request\. You can now message the doctor\.$/,
    "{1} আপনার অনুরোধ গ্রহণ করেছেন। এখন ডাক্তারকে বার্তা পাঠাতে পারেন।",
  ],
  [
    /^(.+?) could not accept your request for (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2} [AP]M)\. You can choose another time\.$/,
    "{1} {d2} তারিখে {t3}-এর জন্য আপনার অনুরোধ গ্রহণ করতে পারেননি। আপনি অন্য সময় বেছে নিতে পারেন।",
  ],
  [
    /^Your appointment with (.+?) on (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2} [AP]M) was cancelled( by the administration)?\.$/,
    "{1}-এর সাথে {d2} তারিখে {t3}-এর আপনার অ্যাপয়েন্টমেন্ট বাতিল হয়েছে{by4}।",
  ],
  [
    /^Your appointment with (.+?) on (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2} [AP]M) was marked as completed\.$/,
    "{1}-এর সাথে {d2} তারিখে {t3}-এর আপনার অ্যাপয়েন্টমেন্ট সম্পন্ন হিসেবে চিহ্নিত হয়েছে।",
  ],
  [
    /^(.+?)'s request for (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2} [AP]M) was (accepted|rejected)( by the administration)?\.$/,
    "{1}-এর {d2} তারিখে {t3}-এর অনুরোধ {t4} হয়েছে{by5}।",
  ],
  [
    /^(.+?)'s appointment on (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2} [AP]M) was cancelled\.$/,
    "{1}-এর {d2} তারিখে {t3}-এর অ্যাপয়েন্টমেন্ট বাতিল হয়েছে।",
  ],
  [
    /^(.+?)'s appointment on (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2} [AP]M) was marked as completed\.$/,
    "{1}-এর {d2} তারিখে {t3}-এর অ্যাপয়েন্টমেন্ট সম্পন্ন হিসেবে চিহ্নিত হয়েছে।",
  ],
  [
    /^(.+?) asked for (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2} [AP]M): "(.*)"$/,
    "{1} {d2} তারিখে {t3}-এর জন্য অনুরোধ করেছেন: “{4}”",
  ],
  [
    /^Your request to (.+?) for (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2} [AP]M) is waiting for an answer\.$/,
    "{1}-এর কাছে {d2} তারিখে {t3}-এর জন্য আপনার অনুরোধ উত্তরের অপেক্ষায় আছে।",
  ],
  [
    /^(.+?) accepted the invitation and is completing their application\.$/,
    "{1} আমন্ত্রণ গ্রহণ করেছেন এবং আবেদন সম্পূর্ণ করছেন।",
  ],
  [/^(.+?) uploaded "(.+)" for review\.$/, "{1} পর্যালোচনার জন্য “{2}” আপলোড করেছেন।"],
  [
    /^(.+?) asked to deactivate their account: "(.*)"$/,
    "{1} তাঁর অ্যাকাউন্ট নিষ্ক্রিয় করার অনুরোধ করেছেন: “{2}”",
  ],
  [/^(.+?) wrote: "(.*)"$/, "{1} লিখেছেন: “{2}”"],
  [/^Sent a file: (.+)$/, "একটি ফাইল পাঠিয়েছেন: {1}"],
  [/^The file is larger than (\d+) MB\.$/, "ফাইলটি {d1} এমবি-র চেয়ে বড়।"],
  [/^Messages can have at most ([\d,]+) characters\.$/, "বার্তায় সর্বোচ্চ {d1}টি অক্ষর থাকতে পারে।"],
  [/^You can apply again from (.+)\.$/, "আপনি {t1} থেকে আবার আবেদন করতে পারবেন।"],
  [
    /^You can upload at most (\d+) certificate files\. Remove one first\.$/,
    "সর্বোচ্চ {d1}টি সনদের ফাইল আপলোড করা যায়। আগে একটি সরান।",
  ],
  [
    /^This account is (.+)\. Contact Carewell administration\.$/,
    "এই অ্যাকাউন্টটি {t1}। কেয়ারওয়েল প্রশাসনের সাথে যোগাযোগ করুন।",
  ],
  [
    /^This account is not authorised for the (.+) portal\.$/,
    "এই অ্যাকাউন্টটি {t1} পোর্টালের জন্য অনুমোদিত নয়।",
  ],
  [/^This (.+) is unavailable\.$/, "{n1} পাওয়া যাচ্ছে না।"],
  [/^A (.+) request cannot be changed to (.+)\.$/, "{t1} অনুরোধ {t2} করা যায় না।"],
  [/^(\d+) min ago$/, "{d1} মিনিট আগে"],
  [/^(\d+) h ago$/, "{d1} ঘণ্টা আগে"],
  [/^(\d+) d ago$/, "{d1} দিন আগে"],
  [/^(\d+) doctors? found$/, "{d1}জন ডাক্তার পাওয়া গেছে"],
  [/^(\d+) years? experience$/, "{d1} বছরের অভিজ্ঞতা"],
  [/^(\d+) years?$/, "{d1} বছর"],
  [/^(\d+) patient reviews?$/, "{d1}টি রোগীর রিভিউ"],
  [/^(\d+) reviews?$/, "{d1}টি রিভিউ"],
  [/^(\d+) places?$/, "{d1}টি স্থান"],
  [/^(\d+) patients?$/, "{d1}জন রোগী"],
  [/^(\d+) profiles?$/, "{d1}টি প্রোফাইল"],
  [/^(\d+) facilit(?:y|ies)$/, "{d1}টি প্রতিষ্ঠান"],
  [/^(\d+) appointments?$/, "{d1}টি অ্যাপয়েন্টমেন্ট"],
  [/^(\d+) unread$/, "{d1}টি অপঠিত"],
  [/^(\d+) KB$/, "{d1} কেবি"],
  [/^([\d.]+) km( away)?$/, "{d1} কিমি{away}"],
  [/^(\d+)\/(\d+) steps?$/, "ধাপ {d1}/{d2}"],
  [/^Notifications \((\d+) unread\)$/, "বিজ্ঞপ্তি ({d1}টি অপঠিত)"],
  [/^(\d+) unread messages?$/, "{d1}টি অপঠিত বার্তা"],
  [/^([\d.]+) out of 5 stars?$/, "৫-এর মধ্যে {d1} তারা"],
  [/^([\d.]+) out of 5 from (\d+) reviews?\. Show reviews$/, "{d2}টি রিভিউয়ে ৫-এর মধ্যে {d1}। রিভিউ দেখুন"],
  [/^Up to ([\d,]+\+?)$/, "সর্বোচ্চ {d1}"],
  [/^Send again in (\d+)s$/, "{d1} সেকেন্ড পরে আবার পাঠান"],
  [/^Resend in (\d+)s$/, "{d1} সেকেন্ড পরে আবার পাঠান"],
  [/^Switch to (dark|light) theme$/, "{t1} থিমে যান"],
  [/^Switch to (Bangla|English)$/, "{t1}-এ পরিবর্তন করুন"],
  [/^Save (.+)$/, "{1} সংরক্ষণ করুন"],
  [/^Remove (.+) from saved doctors$/, "সংরক্ষিত ডাক্তার থেকে {1} সরান"],
  [/^Open conversation with (.+)$/, "{1}-এর সাথে কথোপকথন খুলুন"],
  [/^Edit (.+)$/, "{1} সম্পাদনা"],
  [/^Update (.+) appointment$/, "{1}-এর অ্যাপয়েন্টমেন্ট হালনাগাদ"],
  [/^Deactivate (.+)\?$/, "{1}-কে নিষ্ক্রিয় করবেন?"],
  [/^Suspend (.+)\?$/, "{1}-কে স্থগিত করবেন?"],
  [/^Remove (.+)\?$/, "{1} সরাবেন?"],
  [/^Remove (.+)$/, "{1} সরান"],
  [/^Welcome, (.+)$/, "স্বাগতম, {1}"],
  [/^Request marked (.+)\.$/, "অনুরোধটি “{t1}” হিসেবে চিহ্নিত হয়েছে।"],
  [/^Invitation link valid until (.+)$/, "আমন্ত্রণ লিঙ্ক বৈধ থাকবে {t1} পর্যন্ত"],
  [/^Submitted (.+)$/, "জমা দেওয়া হয়েছে {t1}"],
  [/^Submitted on (.+)$/, "জমা দেওয়া হয়েছে {t1}"],
  [/^No (.+) requests$/, "কোনো {t1} অনুরোধ নেই"],
  [/^A new invitation link was sent to (.+)\.$/, "{1}-এ একটি নতুন আমন্ত্রণ লিঙ্ক পাঠানো হয়েছে।"],
  [
    /^We sent a 6-digit code to (.+)\. Enter it to activate your account\.$/,
    "আমরা {1}-এ একটি ৬ অঙ্কের কোড পাঠিয়েছি। অ্যাকাউন্ট চালু করতে সেটি লিখুন।",
  ],
  [
    /^If an account exists for (.+), we’ve emailed a link to choose a new password\. It expires after a short time\.$/,
    "{1}-এর কোনো অ্যাকাউন্ট থাকলে নতুন পাসওয়ার্ড বেছে নেওয়ার একটি লিঙ্ক ইমেইলে পাঠানো হয়েছে। লিঙ্কটি অল্প সময় পরে মেয়াদোত্তীর্ণ হবে।",
  ],
  [
    /^(.+) will lose account access and their profile will be removed from the directory\.$/,
    "{1} অ্যাকাউন্টে প্রবেশের সুযোগ হারাবেন এবং তাঁর প্রোফাইল তালিকা থেকে সরে যাবে।",
  ],
  [/^(.+) will keep an active account and profile\.$/, "{1}-এর অ্যাকাউন্ট ও প্রোফাইল সক্রিয় থাকবে।"],
  [
    /^The Carewell administration added you as a doctor \((.+)\)\. Choose a password to continue\. This link expires on (.+)\.$/,
    "কেয়ারওয়েল প্রশাসন আপনাকে ডাক্তার হিসেবে যোগ করেছে ({1})। চালিয়ে যেতে একটি পাসওয়ার্ড বেছে নিন। এই লিঙ্কের মেয়াদ শেষ হবে {t2}।",
  ],
  [/^Signed in as (.+) · (.+)$/, "{1} হিসেবে সাইন ইন করা আছে · {t2}"],
  [/^(.+?), (\d+) appointments?$/, "{t1}, {d2}টি অ্যাপয়েন্টমেন্ট"],
  [/^(.+): (\d+) appointments?$/, "{t1}: {d2}টি অ্যাপয়েন্টমেন্ট"],
  [/^New (\d)-star review$/, "নতুন {d1} তারার রিভিউ"],
  [/^New message from (.+)$/, "{1}-এর কাছ থেকে নতুন বার্তা"],
  [/^(.+) rated you (\d) out of 5\.$/, "{1} আপনাকে ৫-এর মধ্যে {d2} রেটিং দিয়েছেন।"],
  [/^(.+) asked to deactivate their account\.$/, "{1} তাঁর অ্যাকাউন্ট নিষ্ক্রিয় করার অনুরোধ করেছেন।"],
  [
    /^(.+) submitted an application\. Check their BMDC certificate\.$/,
    "{1} আবেদন জমা দিয়েছেন। তাঁর বিএমডিসি সনদ দেখুন।",
  ],
  [/^(.+) changed their (.+)\.$/, "{1} তাঁর {t2} পরিবর্তন করেছেন।"],
  [/^(Appointment) (accepted|rejected|cancelled|completed)$/, "অ্যাপয়েন্টমেন্ট {t2}"],
  [
    /^Appointment (accepted|rejected|cancelled|completed) by the administration$/,
    "প্রশাসন অ্যাপয়েন্টমেন্ট {t1} করেছে",
  ],
  [/^(.+) asked for (.+) at (.+)\.$/, "{1} {t3}-এ {t2}-এর জন্য অনুরোধ করেছেন।"],
  [/^(.+) cancelled (.+) at (.+)\.$/, "{1} {t3}-এ {t2}-এর অনুরোধ বাতিল করেছেন।"],
];

// "This doctor profile is unavailable." and its relatives: the thing the server could not find.
const THINGS = {
  "doctor profile": "এই ডাক্তারের প্রোফাইল",
  facility: "এই প্রতিষ্ঠান",
  request: "এই অনুরোধ",
  "availability slot": "এই সময়",
  patient: "এই রোগী",
  review: "এই রিভিউ",
  certificate: "এই সনদ",
  conversation: "এই কথোপকথন",
  notification: "এই বিজ্ঞপ্তি",
  photo: "এই ছবি",
  file: "এই ফাইল",
  "support request": "এই সহায়তার অনুরোধ",
  "clinic for the selected doctor": "নির্বাচিত ডাক্তারের এই ক্লিনিক",
  "doctor at that clinic": "ওই ক্লিনিকে এই ডাক্তার",
};

const fill = (template, match, translateInner) =>
  template.replace(/\{(t|d|by|n)?(\d)\}|\{away\}/g, (token, mode, index) => {
    if (token === "{away}") return match[2] ? " দূরে" : "";
    if (mode === "n") return THINGS[match[Number(index)]] ?? match[Number(index)];
    if (mode === "by") return match[Number(index)] ? " (প্রশাসনের মাধ্যমে)" : "";
    const value = match[Number(index)] ?? "";
    if (mode === "d") return bnDigits(value);
    if (mode === "t") return translateInner(value) ?? bnDigits(value);
    return translateInner(value) ?? value; // a name from the sample data gets its Bengali spelling; others stay as written
  });

/** "Agrabad Specialist Clinic · Agrabad", ", Dhaka": translate the pieces that have Bengali and keep the rest. */
function translateParts(key) {
  const parts = key.split(/( · |, )/);
  if (parts.length < 2) return null;
  let changed = false;
  const out = parts.map((part) => {
    if (part === " · " || part === ", " || !part) return part;
    const bengali = translatePiece(part);
    if (bengali) changed = true;
    return bengali ?? part;
  });
  return changed ? out.join("") : null;
}

function translatePiece(piece) {
  if (Object.hasOwn(BN, piece)) return BN[piece];
  if (LOWER.has(piece.toLowerCase())) return LOWER.get(piece.toLowerCase());
  return numbersOnly(piece) ?? dateWords(piece);
}

export function translate(text) {
  if (typeof text !== "string") return null;
  const key = normalise(text);
  if (!key || !/[A-Za-z0-9]/.test(key)) return null;
  if (Object.hasOwn(BN, key)) return BN[key];
  if (LOWER.has(key.toLowerCase())) return LOWER.get(key.toLowerCase());
  const numeric = numbersOnly(key);
  if (numeric) return numeric;
  const dated = dateWords(key);
  if (dated) return dated;
  for (const [pattern, template] of PATTERNS) {
    const match = key.match(pattern);
    if (match) return fill(template, match, translate);
  }
  return translateParts(key);
}
