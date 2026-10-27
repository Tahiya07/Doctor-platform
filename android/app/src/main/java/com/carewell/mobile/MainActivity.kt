package com.carewell.mobile

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/** Native patient experience: sign in, browse doctors, request visits and track appointments. */
class MainActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var content: LinearLayout
    private lateinit var user: JSONObject
    private var doctors = JSONArray()
    private var clinics = JSONArray()
    private var selectedDoctor: JSONObject? = null
    private var selectedFacilityId = ""
    private var selectedDate = today()
    private var patientName = ""
    private var patientPhone = ""
    private var reasonText = ""
    private var banner: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(10, 96, 91)
        window.navigationBarColor = Color.rgb(10, 96, 91)
        showLoading("Connecting to Carewell…")
        runApi({ CarewellApi.get("/auth/me") as JSONObject }) { result ->
            if (result.isSuccess) {
                user = result.getOrThrow().optJSONObject("user") ?: JSONObject()
                showHome("doctors")
            } else {
                showLogin()
            }
        }
    }

    private fun showLoading(message: String) {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(28), dp(28), dp(28))
            setBackgroundColor(Color.rgb(245, 249, 248))
        }
        root.addView(label("Carewell", 30, Color.rgb(10, 96, 91), true))
        root.addView(label(message, 16, Color.DKGRAY).apply { setPadding(0, dp(16), 0, 0) })
        setContentView(root)
    }

    private fun showLogin(message: String? = null) {
        val root = basePage()
        root.addView(label("Carewell", 30, teal, true))
        root.addView(label("Care that fits your life", 16, muted).apply { setPadding(0, 0, 0, dp(24)) })
        if (!message.isNullOrBlank()) root.addView(note(message))
        val email = field("Email address", android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        val password = field("Password", android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD)
        root.addView(email)
        root.addView(password)
        val signIn = action("Sign in")
        root.addView(signIn)
        signIn.setOnClickListener {
            signIn.isEnabled = false
            runApi({
                CarewellApi.post("/auth/login", JSONObject().put("email", email.text.toString().trim())
                    .put("password", password.text.toString()).put("portal", "patient")) as JSONObject
            }) { result ->
                signIn.isEnabled = true
                if (result.isSuccess) {
                    user = result.getOrThrow().optJSONObject("user") ?: JSONObject()
                    banner = "Signed in successfully."
                    showHome("doctors")
                } else showLogin(result.exceptionOrNull()?.message ?: "Sign in failed.")
            }
        }
        root.addView(label("Sign in with your Carewell patient account to book and manage visits.", 14, muted)
            .apply { setPadding(0, dp(20), 0, 0) })
        root.addView(action("Create a patient account").apply { setOnClickListener { showRegistration() } })
        setContentView(root)
    }

    private fun showRegistration(message: String? = null) {
        val root = basePage()
        root.addView(action("‹  Back to sign in").apply { setOnClickListener { showLogin() } })
        root.addView(label("Create your account", 24, ink, true))
        root.addView(label("Use at least 10 characters with a capital, lowercase letter, number and symbol.", 14, muted))
        if (!message.isNullOrBlank()) root.addView(note(message))
        val name = field("Full name")
        val email = field("Email address", android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        val phone = field("Phone number", android.text.InputType.TYPE_CLASS_PHONE)
        val password = field("Password", android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD)
        root.addView(name); root.addView(email); root.addView(phone); root.addView(password)
        val create = action("Create account")
        root.addView(create)
        create.setOnClickListener {
            create.isEnabled = false
            val request = JSONObject().put("name", name.text.toString().trim())
                .put("email", email.text.toString().trim()).put("phone", phone.text.toString().trim())
                .put("password", password.text.toString())
            runApi({ CarewellApi.post("/auth/patient/register", request) as JSONObject }) { result ->
                create.isEnabled = true
                if (result.isSuccess) {
                    user = result.getOrThrow().optJSONObject("user") ?: JSONObject()
                    showVerification("A 6-digit code was sent to ${user.optString("email") }.")
                } else showRegistration(result.exceptionOrNull()?.message ?: "Could not create the account.")
            }
        }
        setContentView(root)
    }

    private fun showVerification(message: String? = null) {
        val root = basePage()
        root.addView(label("Verify your email", 24, ink, true))
        root.addView(label(message ?: "Enter the 6-digit code sent to ${user.optString("email")}.", 15, muted))
        val code = field("6-digit verification code", android.text.InputType.TYPE_CLASS_NUMBER)
        root.addView(code)
        val verify = action("Verify email")
        root.addView(verify)
        verify.setOnClickListener {
            verify.isEnabled = false
            runApi({ CarewellApi.post("/auth/verify-email", JSONObject().put("code", code.text.toString().trim())) as JSONObject }) { result ->
                verify.isEnabled = true
                if (result.isSuccess) {
                    user = result.getOrThrow().optJSONObject("user") ?: user
                    banner = "Email verified. You can now request appointments."
                    showHome("doctors")
                } else showVerification(result.exceptionOrNull()?.message ?: "Could not verify email.")
            }
        }
        root.addView(action("Resend code").apply {
            setOnClickListener {
                runApi({ CarewellApi.post("/auth/verify-email/resend", JSONObject()) }) { result ->
                    showVerification(if (result.isSuccess) "A new code was sent. Check your email." else result.exceptionOrNull()?.message)
                }
            }
        })
        root.addView(action("Back to sign in").apply { setOnClickListener { showLogin() } })
        setContentView(root)
    }

    private fun showHome(tab: String) {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(245, 249, 248))
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(14))
            setBackgroundColor(Color.WHITE)
        }
        header.addView(label("Carewell", 25, teal, true))
        header.addView(label("Hello, ${user.optString("name", "there")}", 14, muted))
        page.addView(header)
        val scroll = ScrollView(this)
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(20))
        }
        scroll.addView(content)
        page.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(8), dp(8), dp(8), dp(8))
            setBackgroundColor(Color.WHITE)
        }
        listOf("doctors" to "Find care", "appointments" to "Appointments", "account" to "Account").forEach { (key, title) ->
            val button = Button(this).apply { text = title; isAllCaps = false }
            nav.addView(button, LinearLayout.LayoutParams(0, -2, 1f))
            button.setOnClickListener { showHome(key) }
        }
        page.addView(nav)
        setContentView(page)
        when (tab) {
            "appointments" -> loadAppointments()
            "account" -> showAccount()
            else -> loadDoctors()
        }
    }

    private fun loadDoctors(search: String = "") {
        content.removeAllViews()
        content.addView(label("Find a doctor", 22, ink, true))
        val query = field("Doctor, specialty, or location")
        query.setText(search)
        val searchButton = action("Search")
        content.addView(query)
        content.addView(searchButton)
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(results)
        fun request() {
            results.removeAllViews()
            results.addView(label("Loading doctors…", 15, muted))
            runApi({ CarewellApi.get(CarewellApi.query("/doctors", mapOf("query" to query.text.toString().trim()))) as JSONArray }) { response ->
                results.removeAllViews()
                if (response.isFailure) {
                    results.addView(note(response.exceptionOrNull()?.message ?: "Could not load doctors."))
                    return@runApi
                }
                doctors = response.getOrThrow()
                if (doctors.length() == 0) results.addView(label("No doctors matched. Try another search.", 15, muted))
                for (i in 0 until doctors.length()) {
                    val doctor = doctors.getJSONObject(i)
                    val card = card()
                    card.addView(label(doctor.optString("name"), 18, ink, true))
                    card.addView(label("${doctor.optString("specialty")} · ${doctor.optInt("experienceYears")} years' experience", 14, muted))
                    card.addView(label("${doctor.optString("location")} · BDT ${doctor.optInt("fee")}", 14, muted))
                    card.addView(label("Next available: ${doctor.optString("nextAvailable", "To be scheduled")}", 14, teal))
                    val open = action("View doctor and times")
                    card.addView(open)
                    open.setOnClickListener { openDoctor(doctor) }
                    results.addView(card)
                }
            }
        }
        searchButton.setOnClickListener { request() }
        request()
    }

    private fun openDoctor(doctor: JSONObject) {
        selectedDoctor = doctor
        content.removeAllViews()
        content.addView(action("‹  Back to doctors").apply { setOnClickListener { showHome("doctors") } })
        content.addView(label(doctor.optString("name"), 24, ink, true))
        content.addView(label(doctor.optString("specialty"), 17, teal))
        content.addView(label(doctor.optString("qualifications"), 14, muted))
        content.addView(label("${doctor.optInt("experienceYears")} years' experience · BDT ${doctor.optInt("fee")}", 15, ink))
        content.addView(label("${doctor.optDouble("rating", 0.0)} ★ · ${doctor.optInt("reviewCount")} reviews", 14, muted))
        val places = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(label("Choose a clinic", 19, ink, true))
        content.addView(places)
        runApi({ CarewellApi.get("/clinics") as JSONArray }) { result ->
            places.removeAllViews()
            if (result.isFailure) {
                places.addView(note(result.exceptionOrNull()?.message ?: "Could not load clinics."))
                return@runApi
            }
            clinics = result.getOrThrow()
            val ids = doctor.optJSONArray("facilityIds") ?: JSONArray()
            for (i in 0 until clinics.length()) {
                val clinic = clinics.getJSONObject(i)
                if ((0 until ids.length()).none { ids.optString(it) == clinic.optString("id") }) continue
                val choose = action("${clinic.optString("name")} · ${clinic.optString("area")}, ${clinic.optString("city")}")
                places.addView(choose)
                choose.setOnClickListener { selectedFacilityId = clinic.optString("id"); showBookingDate(doctor, clinic) }
            }
            if (places.childCount == 0) places.addView(note("No active clinics are listed for this doctor."))
        }
    }

    private fun showBookingDate(doctor: JSONObject, clinic: JSONObject) {
        content.removeAllViews()
        content.addView(action("‹  Back to doctor").apply { setOnClickListener { openDoctor(doctor) } })
        content.addView(label("Request an appointment", 22, ink, true))
        content.addView(label(clinic.optString("name"), 15, teal))
        val date = field("Appointment date (YYYY-MM-DD)")
        date.setText(selectedDate)
        content.addView(date)
        val getTimes = action("Show available times")
        content.addView(getTimes)
        val slotsView = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(slotsView)
        getTimes.setOnClickListener {
            selectedDate = date.text.toString().trim()
            slotsView.removeAllViews()
            slotsView.addView(label("Checking availability…", 14, muted))
            val path = CarewellApi.query("/doctors/${doctor.optString("id")}/slots", mapOf("facilityId" to selectedFacilityId, "date" to selectedDate))
            runApi({ CarewellApi.get(path) as JSONArray }) { result ->
                slotsView.removeAllViews()
                if (result.isFailure) {
                    slotsView.addView(note(result.exceptionOrNull()?.message ?: "Could not load times."))
                    return@runApi
                }
                val slots = result.getOrThrow()
                for (i in 0 until slots.length()) {
                    val slot = slots.getJSONObject(i)
                    if (slot.optString("status") != "available") continue
                    val pick = action("Request ${slot.optString("label")}")
                    slotsView.addView(pick)
                    pick.setOnClickListener { confirmBooking(doctor, slot) }
                }
                if (slotsView.childCount == 0) slotsView.addView(note("No open times on this date. Choose another day."))
            }
        }
    }

    private fun confirmBooking(doctor: JSONObject, slot: JSONObject) {
        content.removeAllViews()
        content.addView(action("‹  Back to times").apply { setOnClickListener { openDoctor(doctor) } })
        content.addView(label("A few details", 22, ink, true))
        val name = field("Patient's full name")
        name.setText(user.optString("name"))
        val phone = field("Contact phone", android.text.InputType.TYPE_CLASS_PHONE)
        val email = field("Contact email", android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        email.setText(user.optString("email"))
        val reason = field("Reason for visit (at least 5 characters)")
        content.addView(label("${doctor.optString("name")} · ${selectedDate} · ${slot.optString("label")}", 15, teal))
        content.addView(name); content.addView(phone); content.addView(email); content.addView(reason)
        val submit = action("Send appointment request")
        content.addView(submit)
        submit.setOnClickListener {
            patientName = name.text.toString().trim()
            patientPhone = phone.text.toString().trim()
            reasonText = reason.text.toString().trim()
            submit.isEnabled = false
            val body = JSONObject().put("doctorId", doctor.optString("id"))
                .put("facilityId", selectedFacilityId).put("date", selectedDate)
                .put("slotId", slot.optString("id")).put("relationship", "self")
                .put("patientName", patientName).put("phone", patientPhone)
                .put("email", email.text.toString().trim()).put("reason", reasonText)
            runApi({ CarewellApi.post("/appointment-requests", body) }) { result ->
                submit.isEnabled = true
                if (result.isSuccess) {
                    banner = "Your request was sent. The doctor will review it."
                    showHome("appointments")
                } else content.addView(note(result.exceptionOrNull()?.message ?: "Could not send request."))
            }
        }
    }

    private fun loadAppointments() {
        content.removeAllViews()
        content.addView(label("Your appointments", 22, ink, true))
        content.addView(label("Appointment requests and their latest status.", 14, muted))
        runApi({ CarewellApi.get("/appointments") as JSONArray }) { result ->
            if (result.isFailure) {
                content.addView(note(result.exceptionOrNull()?.message ?: "Could not load appointments."))
                return@runApi
            }
            val visits = result.getOrThrow()
            if (visits.length() == 0) content.addView(note("No appointment requests yet. Find a doctor to get started."))
            for (i in 0 until visits.length()) {
                val visit = visits.getJSONObject(i)
                val doctor = visit.optJSONObject("doctor") ?: JSONObject()
                val facility = visit.optJSONObject("facility") ?: JSONObject()
                val card = card()
                card.addView(label(doctor.optString("name"), 18, ink, true))
                card.addView(label(doctor.optString("specialty"), 14, muted))
                card.addView(label("${visit.optString("date")} · ${visit.optString("time")}", 15, teal))
                card.addView(label(facility.optString("name"), 14, muted))
                card.addView(label("Status: ${visit.optString("status").replaceFirstChar { it.uppercase() }}", 15, ink))
                if (visit.optString("status") in listOf("pending", "accepted")) {
                    val cancel = action("Cancel request")
                    card.addView(cancel)
                    cancel.setOnClickListener {
                        cancel.isEnabled = false
                        runApi({ CarewellApi.patch("/appointment-requests/${visit.optString("id")}", JSONObject().put("status", "cancelled")) }) {
                            if (it.isSuccess) showHome("appointments") else cancel.isEnabled = true
                        }
                    }
                }
                content.addView(card)
            }
        }
    }

    private fun showAccount() {
        content.removeAllViews()
        content.addView(label("Your account", 22, ink, true))
        content.addView(label(user.optString("name"), 18, ink, true))
        content.addView(label(user.optString("email"), 15, muted))
        content.addView(label("Patient account · ${if (user.optBoolean("emailVerified", false)) "email verified" else "email verification may be required to book"}", 14, muted))
        if (!user.optBoolean("emailVerified", false))
            content.addView(action("Verify email").apply { setOnClickListener { showVerification() } })
        val logout = action("Sign out")
        content.addView(logout)
        logout.setOnClickListener {
            runApi({ CarewellApi.post("/auth/logout", JSONObject()) }) {
                user = JSONObject()
                showLogin(if (it.isSuccess) null else it.exceptionOrNull()?.message)
            }
        }
    }

    private fun basePage() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(24), dp(24), dp(24), dp(24))
        setBackgroundColor(Color.rgb(245, 249, 248))
    }

    private fun field(hintText: String, inputType: Int = android.text.InputType.TYPE_CLASS_TEXT) = EditText(this).apply {
        hint = hintText
        this.inputType = inputType
        textSize = 16f
        setSingleLine(inputType != android.text.InputType.TYPE_CLASS_TEXT)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        background = getDrawable(android.R.drawable.edit_text)
        val lp = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) }
        layoutParams = lp
    }

    private fun action(title: String) = Button(this).apply {
        text = title
        isAllCaps = false
        setTextColor(Color.WHITE)
        setBackgroundColor(teal)
        textSize = 15f
        val lp = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6); bottomMargin = dp(8) }
        layoutParams = lp
    }

    private fun label(text: String, size: Int, color: Int, bold: Boolean = false) = TextView(this).apply {
        this.text = text
        textSize = size.toFloat()
        setTextColor(color)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, dp(4), 0, dp(4))
    }

    private fun note(text: String) = TextView(this).apply {
        this.text = text
        textSize = 14f
        setTextColor(ink)
        setPadding(dp(14), dp(14), dp(14), dp(14))
        setBackgroundColor(Color.rgb(232, 243, 241))
    }

    private fun card() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(14), dp(12), dp(14), dp(12))
        setBackgroundColor(Color.WHITE)
        val lp = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10); bottomMargin = dp(4) }
        layoutParams = lp
    }

    private fun runApi(task: () -> Any?, done: (Result<Any?>) -> Unit) {
        worker.execute {
            val result = runCatching(task)
            runOnUiThread { done(result) }
        }
    }

    private fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
        timeZone = java.util.TimeZone.getTimeZone("Asia/Dhaka")
    }.format(Date())
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        worker.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private val teal = Color.rgb(10, 96, 91)
        private val muted = Color.rgb(90, 107, 108)
        private val ink = Color.rgb(27, 43, 45)
    }
}

