import { afterEach, describe, expect, it } from "vitest";
import { startBengaliTranslation } from "./domTranslator.js";
import { bnDigits, translate } from "./translate.js";

describe("translate", () => {
  it("uses the dictionary and ignores spacing and capitals", () => {
    expect(translate("Sign in")).toBe("সাইন ইন");
    expect(translate("  Sign   in ")).toBe("সাইন ইন");
    expect(translate("FACILITY")).toBe("প্রতিষ্ঠান");
    expect(translate("Cardiology")).toBe("হৃদরোগ");
  });

  it("leaves names, emails and already-Bengali text alone", () => {
    for (const text of [
      "Prothom Debnath",
      "Dr. Someone Else",
      "ayesha@carewell.test",
      "ঢাকা",
      "MBBS, MD (Cardiology)",
      "   ",
    ])
      expect(translate(text)).toBeNull();
    expect(translate("constructor")).toBeNull();
  });

  it("writes numbers in Bengali digits but keeps phone numbers and ids", () => {
    expect(bnDigits("৳1,100")).toBe("৳১,১০০");
    expect(translate("16")).toBe("১৬");
    expect(translate("৳1,100")).toBe("৳১,১০০");
    expect(translate("01 / 03")).toBe("০১ / ০৩");
    expect(translate("৳3,000+")).toBe("৳৩,০০০+");
    expect(translate("+880 1711 100001")).toBeNull();
    expect(translate("01531787267")).toBeNull();
  });

  it("says times the way people say them", () => {
    expect(translate("3:00 PM")).toBe("বিকাল ৩:০০");
    expect(translate("9:30 AM")).toBe("সকাল ৯:৩০");
    expect(translate("12:15 PM")).toBe("দুপুর ১২:১৫");
    expect(translate("8:00 PM")).toBe("রাত ৮:০০");
    expect(translate("Tomorrow, 3:00 PM")).toBe("আগামীকাল, বিকাল ৩:০০");
    expect(translate("Mon 26")).toBe("সোম ২৬");
    expect(translate("Oct 26, 10:54 PM")).toBe("অক্টোবর ২৬, রাত ১০:৫৪");
  });

  it("translates sentences that contain counts and names", () => {
    expect(translate("5 min ago")).toBe("৫ মিনিট আগে");
    expect(translate("14 years experience")).toBe("১৪ বছরের অভিজ্ঞতা");
    expect(translate("Notifications (4 unread)")).toBe("বিজ্ঞপ্তি (৪টি অপঠিত)");
    expect(translate("Suspend Browser Suspend Me?")).toBe("Browser Suspend Me-কে স্থগিত করবেন?");
    expect(translate("Switch to dark theme")).toBe("ডার্ক থিমে যান");
    expect(translate("Request marked in progress.")).toBe("অনুরোধটি “চলমান” হিসেবে চিহ্নিত হয়েছে।");
  });

  it("translates what the server says, keeping the names", () => {
    expect(translate("Wrong email or password.")).toBe("ইমেইল বা পাসওয়ার্ড ভুল।");
    expect(translate("Dr. Someone Else accepted your request. You can now message the doctor.")).toBe(
      "Dr. Someone Else আপনার অনুরোধ গ্রহণ করেছেন। এখন ডাক্তারকে বার্তা পাঠাতে পারেন।",
    );
    expect(translate("Dr. Nusrat Karim accepted your request. You can now message the doctor.")).toBe(
      "ডা. নুসরাত করিম আপনার অনুরোধ গ্রহণ করেছেন। এখন ডাক্তারকে বার্তা পাঠাতে পারেন।",
    );
    expect(
      translate("Your request to Dr. Imran Chowdhury for 2026-10-22 at 3:00 PM is waiting for an answer."),
    ).toBe(
      "ডা. ইমরান চৌধুরী-এর কাছে ২০২৬-১০-২২ তারিখে বিকাল ৩:০০-এর জন্য আপনার অনুরোধ উত্তরের অপেক্ষায় আছে।",
    );
    expect(translate("This doctor profile is unavailable.")).toBe("এই ডাক্তারের প্রোফাইল পাওয়া যাচ্ছে না।");
    expect(translate("New 5-star review")).toBe("নতুন ৫ তারার রিভিউ");
  });

  it("translates the parts of a joined text that have Bengali", () => {
    expect(translate(", Dhaka")).toBe(", ঢাকা");
    expect(translate("Agrabad Specialist Clinic · Agrabad")).toBe("আগ্রাবাদ স্পেশালিস্ট ক্লিনিক · আগ্রাবাদ");
  });
});

describe("page translation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("translates text and placeholders, and keeps names", () => {
    document.body.innerHTML = `<main><h1>Find your doctor.</h1><p>Prothom Debnath</p><input placeholder="Search by name, email or phone" /><textarea placeholder="Your question"></textarea></main>`;
    const stop = startBengaliTranslation(document.body);
    expect(document.querySelector("h1").textContent).toBe("আপনার ডাক্তার খুঁজুন।");
    expect(document.querySelector("p").textContent).toBe("Prothom Debnath");
    expect(document.querySelector("input").placeholder).toBe("নাম, ইমেইল বা ফোন দিয়ে খুঁজুন");
    expect(document.querySelector("textarea").placeholder).toBe("আপনার প্রশ্ন");
    stop();
  });

  it("translates what appears later and what the page rewrites", async () => {
    document.body.innerHTML = `<div id="app"><span>Save changes</span></div>`;
    const stop = startBengaliTranslation(document.body);
    const app = document.getElementById("app");
    const later = document.createElement("button");
    later.textContent = "Sign out";
    app.append(later);
    app.querySelector("span").firstChild.nodeValue = "Cancel"; // what React does when its text changes
    await Promise.resolve();
    expect(later.textContent).toBe("সাইন আউট");
    expect(app.querySelector("span").textContent).toBe("বাতিল করুন");
    stop();
  });

  it("restores the English text exactly when switched back", () => {
    document.body.innerHTML = `<div><button aria-label="Open menu">  Sign in  </button><p>Prothom Debnath</p></div>`;
    const before = document.body.innerHTML;
    const stop = startBengaliTranslation(document.body);
    expect(document.querySelector("button").textContent).toBe("  সাইন ইন  ");
    expect(document.querySelector("button").getAttribute("aria-label")).toBe("মেনু খুলুন");
    stop();
    expect(document.body.innerHTML).toBe(before);
  });

  it("never touches text marked as written by a person", () => {
    document.body.innerHTML = `<p translate="no">Sign in</p><p>Sign in</p>`;
    const stop = startBengaliTranslation(document.body);
    const [mine, other] = document.querySelectorAll("p");
    expect(mine.textContent).toBe("Sign in");
    expect(other.textContent).toBe("সাইন ইন");
    stop();
  });
});
