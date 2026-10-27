package com.carewell.mobile

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.BitmapFactory
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.net.Uri
import android.webkit.MimeTypeMap
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.net.URL
import java.util.concurrent.Executors

/** Native Carewell experience for patients, doctors and administrators. */
class MainActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val imageWorker = Executors.newFixedThreadPool(3)
    private val eventsWorker = Executors.newSingleThreadExecutor()
    @Volatile private var eventsActive = false
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
    private var uploadTarget: String? = null
    private var uploadKind = "other"
    private var activeTab = "discover"
    private var activeConversationId: String? = null
    private var activeConversationTitle = ""
    private var language = "en"
    private var darkTheme = false
    private val bengali by lazy { runCatching { JSONObject(assets.open("bn.json").bufferedReader().use { it.readText() }) }.getOrDefault(JSONObject()) }
    private var appointmentFilter = "all"
    private var appointmentCalendar = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CarewellApi.init(this)
        val preferences = getSharedPreferences("carewell_preferences", MODE_PRIVATE)
        language = preferences.getString("language", "en") ?: "en"
        darkTheme = preferences.getBoolean("dark_theme", true)
        user = JSONObject()
        applySystemTheme()
        if(handleDeepLink(intent))return
        showLoading("Connecting to Carewell…")
        runApi({ CarewellApi.get("/auth/me") as JSONObject }) { result ->
            if (result.isSuccess) {
                user = (result.getOrThrow() as JSONObject).optJSONObject("user") ?: JSONObject()
                startEvents()
                showHome(homeTab())
            } else {
                user = JSONObject()
                showHome("discover")
            }
        }
    }

    override fun onNewIntent(intent:Intent) {
        super.onNewIntent(intent);setIntent(intent);handleDeepLink(intent)
    }

    private fun handleDeepLink(incoming:Intent?):Boolean {
        val fragment=incoming?.data?.fragment?:return false
        val route=fragment.substringBefore('?')
        val query=fragment.substringAfter('?',"").split('&').mapNotNull{part->val p=part.split('=',limit=2);if(p.size==2)java.net.URLDecoder.decode(p[0],"UTF-8") to java.net.URLDecoder.decode(p[1],"UTF-8") else null}.toMap()
        when {
            route.contains("reset-password") -> showResetPassword(query["token"])
            route.contains("doctor/invitation") -> showAcceptInvitation(query["token"])
            route == "staff-1164ab636c75" -> showLogin(portal = "admin")
            route.startsWith("doctors/") -> {
                val id=route.removePrefix("doctors/").substringBefore('/')
                showLoading("Loading doctor profile…")
                runApi({CarewellApi.get("/doctors/$id") as JSONObject}) { result ->
                    if(result.isSuccess)openDoctor(result.getOrThrow() as JSONObject)
                    else { val root=basePage();root.addView(label("Doctor profile unavailable",22,ink,true));root.addView(note(result.exceptionOrNull()?.message?:"This profile is not available."));root.addView(action("Browse doctors").apply{setOnClickListener{showHome("doctors")}});showScrollable(root) }
                }
            }
            route.contains("verify-email") -> {showLoading("Sign in to verify your email.");runApi({CarewellApi.get("/auth/me") as JSONObject}){if(it.isSuccess){user=(it.getOrThrow() as JSONObject).optJSONObject("user")?:JSONObject();showVerification()}else showLogin()}}
            else -> return false
        }
        return true
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?) {
        super.onActivityResult(requestCode,resultCode,data)
        if(requestCode!=300||resultCode!=RESULT_OK)return
        val uri=data?.data?:return
        val path=uploadTarget?:return
        try {
            val bytes=contentResolver.openInputStream(uri)?.use{it.readBytes()}?:throw IllegalStateException("Could not read selected file.")
            val name=contentResolver.query(uri,null,null,null,null)?.use{cursor->if(cursor.moveToFirst())cursor.getString(cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME).coerceAtLeast(0))else "certificate"}?:"certificate"
            val mime=contentResolver.getType(uri)?:MimeTypeMap.getSingleton().getMimeTypeFromExtension(MimeTypeMap.getFileExtensionFromUrl(name))?:"application/octet-stream"
            val photo=path=="/me/photo"
            val allowed=if(photo)listOf("image/jpeg","image/png","image/webp") else if(path.contains("/conversations/"))listOf("application/pdf","image/jpeg","image/png","image/webp","image/gif") else listOf("application/pdf","image/jpeg","image/png","image/webp")
            require(mime in allowed){"This file type is not supported here."}
            require(bytes.size<=if(photo)2*1024*1024 else 10*1024*1024){"The selected file is too large."}
            runApi({CarewellApi.upload(path,name,mime,bytes,if(path=="/doctor/certificates"||path.contains("/admin/doctors/"))mapOf("kind" to uploadKind) else emptyMap())}){if(it.isSuccess){when{path=="/me/photo"->{user=(it.getOrThrow() as JSONObject).optJSONObject("user")?:user;showHome("account")};path.contains("/conversations/")->content.addView(note("Attachment sent."));user.optString("role")=="doctor"->showHome("doctor_application");else->showHome("admin_verification")}}else content.addView(note(it.exceptionOrNull()?.message?:"Upload failed."))}
        } catch(error:Exception) { content.addView(note(error.message?:"Could not open selected file.")) }
    }

    private fun chooseCertificate(path:String) {
        uploadTarget=path
        val picker=Intent(Intent.ACTION_OPEN_DOCUMENT).apply{addCategory(Intent.CATEGORY_OPENABLE);type="*/*";putExtra(Intent.EXTRA_MIME_TYPES,arrayOf("application/pdf","image/jpeg","image/png","image/webp","image/gif"))}
        startActivityForResult(picker,300)
    }

    private fun chooseImage(path:String) {
        uploadTarget=path
        val picker=Intent(Intent.ACTION_OPEN_DOCUMENT).apply{addCategory(Intent.CATEGORY_OPENABLE);type="image/*"}
        startActivityForResult(picker,300)
    }

    private fun showAcceptInvitation(invitationToken:String?=null) {
        val root=basePage();root.addView(label("Accept doctor invitation",24,ink,true));val token=field("Invitation token from email");if(invitationToken!=null)token.setText(invitationToken);val password=field("Choose a password",android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);root.addView(token);root.addView(password)
        root.addView(action("Accept invitation").apply{setOnClickListener{runApi({CarewellApi.post("/auth/doctor/invitation/accept",JSONObject().put("token",token.text.toString().trim()).put("password",password.text.toString())) as JSONObject}){if(it.isSuccess){user=(it.getOrThrow() as JSONObject).optJSONObject("user")?:JSONObject();startEvents();showHome("doctor_application")}else root.addView(note(it.exceptionOrNull()?.message?:"Invitation could not be accepted."))}}})
        showScrollable(root)
    }

    private fun showLoading(message: String) {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(28), dp(28), dp(28))
            setBackgroundColor(if(darkTheme)Color.rgb(18,31,33) else Color.rgb(245,249,248))
        }
        root.addView(label("Carewell", 30, Color.rgb(10, 96, 91), true))
        root.addView(label(message, 16, Color.DKGRAY).apply { setPadding(0, dp(16), 0, 0) })
        showScrollable(root)
    }

    private fun showLogin(message: String? = null, portal: String = "patient") {
        val root = basePage()
        root.addView(label("Carewell", 30, teal, true))
        root.addView(label("Care that fits your life", 16, muted).apply { setPadding(0, 0, 0, dp(24)) })
        root.addView(action(if(language=="bn")"Switch to English" else "বাংলা / Switch to Bangla").apply { setOnClickListener { language=if(language=="bn")"en" else "bn"; getSharedPreferences("carewell_preferences",MODE_PRIVATE).edit().putString("language",language).apply(); showLogin(message,portal) } })
        root.addView(action(if(darkTheme)"Switch to light theme" else "Switch to dark theme").apply { setOnClickListener { darkTheme=!darkTheme; getSharedPreferences("carewell_preferences",MODE_PRIVATE).edit().putBoolean("dark_theme",darkTheme).apply(); applySystemTheme(); showLogin(message,portal) } })
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
                    .put("password", password.text.toString()).put("portal", portal)) as JSONObject
            }) { result ->
                signIn.isEnabled = true
                if (result.isSuccess) {
                    user = (result.getOrThrow() as JSONObject).optJSONObject("user") ?: JSONObject()
                    startEvents()
                    banner = "Signed in successfully."
                    showHome(homeTab())
                } else showLogin(result.exceptionOrNull()?.message ?: "Sign in failed.", portal)
            }
        }
        root.addView(label("${portal.replaceFirstChar { it.uppercase() }} sign in", 14, muted)
            .apply { setPadding(0, dp(20), 0, 0) })
        if (portal == "patient") {
            root.addView(action("Browse Carewell without signing in").apply { setOnClickListener { user = JSONObject(); showHome("discover") } })
            root.addView(action("Create a patient account").apply { setOnClickListener { showRegistration() } })
            root.addView(action("Doctor sign in").apply { setOnClickListener { showLogin(portal = "doctor") } })
            root.addView(action("Accept a doctor invitation").apply { setOnClickListener { showAcceptInvitation() } })
            root.addView(action("Forgot password?").apply { setOnClickListener { showForgotPassword() } })
        } else {
            root.addView(action("Patient sign in").apply { setOnClickListener { showLogin(portal = "patient") } })
            if (portal == "doctor") root.addView(action("Apply as a doctor").apply { setOnClickListener { showDoctorRegistration() } })
            root.addView(action("Forgot password?").apply { setOnClickListener { showForgotPassword() } })
        }
        showScrollable(root)
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
                    user = (result.getOrThrow() as JSONObject).optJSONObject("user") ?: JSONObject()
                    showVerification("A 6-digit code was sent to ${user.optString("email") }.")
                } else showRegistration(result.exceptionOrNull()?.message ?: "Could not create the account.")
            }
        }
        showScrollable(root)
    }

    private fun showForgotPassword(message: String? = null) {
        val root=basePage(); root.addView(action("‹  Back").apply{setOnClickListener{showLogin()}})
        root.addView(label("Reset your password",24,ink,true))
        root.addView(label("We will email a secure reset link if an account matches.",14,muted))
        if(!message.isNullOrBlank())root.addView(note(message))
        val email=field("Email address",android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);root.addView(email)
        root.addView(action("Send reset link").apply{setOnClickListener{runApi({CarewellApi.post("/auth/forgot-password",JSONObject().put("email",email.text.toString().trim()))}){showResetPassword(null,if(it.isSuccess)"If that account exists, a reset link was sent." else it.exceptionOrNull()?.message)}}})
        showScrollable(root)
    }

    private fun showResetPassword(token:String?=null,message:String?=null) {
        val root=basePage();root.addView(label("Choose a new password",24,ink,true));if(!message.isNullOrBlank())root.addView(note(message))
        val resetToken=field("Password reset token from email");if(token!=null)resetToken.setText(token);root.addView(resetToken)
        val password=field("New password",android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);root.addView(password)
        root.addView(action("Save new password").apply{setOnClickListener{runApi({CarewellApi.post("/auth/reset-password",JSONObject().put("token",resetToken.text.toString().trim()).put("password",password.text.toString()))}){if(it.isSuccess)showLogin("Password reset. Sign in with your new password.")else showResetPassword(resetToken.text.toString(),it.exceptionOrNull()?.message)}}})
        showScrollable(root)
    }

    private fun showDoctorRegistration(message:String?=null) {
        val root=basePage();root.addView(action("‹  Back to sign in").apply{setOnClickListener{showLogin(portal="doctor")}})
        root.addView(label("Apply to join Carewell",24,ink,true));root.addView(label("Enter the professional details for your application.",14,muted));if(!message.isNullOrBlank())root.addView(note(message))
        val name=field("Full name");val email=field("Email",android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);val phone=field("Phone",android.text.InputType.TYPE_CLASS_PHONE)
        val password=field("Password (10+ characters)",android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD)
        val specialty=field("Specialty ID (from specialties list)");val qualification=field("Qualifications, comma separated");val years=field("Experience years",android.text.InputType.TYPE_CLASS_NUMBER);val fee=field("Fee in BDT",android.text.InputType.TYPE_CLASS_NUMBER);val location=field("Practice location");val clinicIds=field("Clinic IDs, comma separated")
        listOf(name,email,phone,password,specialty,qualification,years,fee,location,clinicIds).forEach{root.addView(it)}
        root.addView(action("Create doctor application").apply{setOnClickListener{val qs=JSONArray();qualification.text.toString().split(",").map{it.trim()}.filter{it.isNotEmpty()}.forEach{qs.put(it)};val fs=JSONArray();clinicIds.text.toString().split(",").map{it.trim()}.filter{it.isNotEmpty()}.forEach{fs.put(it)};val body=JSONObject().put("name",name.text.toString()).put("email",email.text.toString()).put("phone",phone.text.toString()).put("password",password.text.toString()).put("specialtyId",specialty.text.toString()).put("qualifications",qs).put("experienceYears",years.text.toString().toIntOrNull()?:0).put("fee",fee.text.toString().toIntOrNull()?:0).put("location",location.text.toString()).put("facilityIds",fs);runApi({CarewellApi.post("/auth/doctor/register",body) as JSONObject}){if(it.isSuccess){user=(it.getOrThrow() as JSONObject).optJSONObject("user")?:JSONObject();showVerification("Check ${user.optString("email")} for the verification code.")}else showDoctorRegistration(it.exceptionOrNull()?.message?:"Could not create application.")}}})
        showScrollable(root)
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
                    user = (result.getOrThrow() as JSONObject).optJSONObject("user") ?: user
                    startEvents()
                    banner = "Email verified. You can now request appointments."
                    showHome(homeTab())
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
        showScrollable(root)
    }

    private fun showHome(tab: String) {
        activeTab = tab
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(if(darkTheme)Color.rgb(18,31,33) else Color.rgb(245,249,248))
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(14))
            setBackgroundColor(if(darkTheme)Color.rgb(28,43,45) else Color.WHITE)
        }
        header.addView(label("Carewell", 25, teal, true))
        header.addView(label("Hello, ${user.optString("name", "there")}", 14, muted))
        header.addView(action(if(language=="bn")"Switch to English" else "বাংলা / Switch to Bangla").apply { setOnClickListener { language=if(language=="bn")"en" else "bn"; getSharedPreferences("carewell_preferences",MODE_PRIVATE).edit().putString("language",language).apply(); showHome(activeTab) } })
        header.addView(action(if(darkTheme)"Switch to light theme" else "Switch to dark theme").apply { setOnClickListener { darkTheme=!darkTheme; getSharedPreferences("carewell_preferences",MODE_PRIVATE).edit().putBoolean("dark_theme",darkTheme).apply(); applySystemTheme(); showHome(activeTab) } })
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
            setBackgroundColor(if(darkTheme)Color.rgb(28,43,45) else Color.WHITE)
        }
        val role = user.optString("role")
        val menu = when (role) {
            "doctor" -> listOf("doctor_dashboard" to "Practice", "doctor_application" to "Application", "doctor_availability" to "Availability", "messages" to "Messages", "notifications" to "Alerts", "account" to "Account")
            "admin" -> listOf("admin_overview" to "Overview", "admin_doctors" to "Doctors", "admin_verification" to "Verify", "admin_facilities" to "Clinics", "admin_appointments" to "Visits", "admin_patients" to "Patients", "admin_reviews" to "Reviews", "admin_specialties" to "Specialties", "admin_availability" to "Availability", "admin_support" to "Support", "admin_deactivation" to "Deactivation", "messages" to "Messages", "notifications" to "Alerts", "account" to "Account")
            "patient" -> listOf("discover" to "Discover", "doctors" to "Doctors", "favorites" to "Saved", "facilities" to "Clinics", "assistance" to "Help", "appointments" to "Visits", "messages" to "Messages", "notifications" to "Alerts", "account" to "Account")
            else -> listOf("discover" to "Discover", "doctors" to "Doctors", "favorites" to "Saved", "facilities" to "Clinics", "assistance" to "Help", "login" to "Sign in", "signup" to "Create account", "doctor_login" to "Doctor sign in")
        }
        menu.forEach { (key, title) ->
            val button = Button(this).apply { text = translate(title); isAllCaps = false }
            nav.addView(button, LinearLayout.LayoutParams(-2, -2))
            button.setOnClickListener { showHome(key) }
        }
        page.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(nav) })
        setContentView(page)
        when (tab) {
            "discover" -> loadDiscover()
            "favorites" -> loadDoctors(savedOnly = true)
            "appointments" -> loadAppointments()
            "account" -> showAccount()
            "facilities" -> loadFacilities()
            "assistance" -> showAssistance()
            "messages" -> loadConversations()
            "notifications" -> loadNotifications()
            "doctor_dashboard" -> loadDoctorDashboard()
            "doctor_application" -> loadDoctorApplication()
            "doctor_availability" -> loadAvailability(false)
            "admin_overview" -> loadAdminOverview()
            "admin_doctors" -> loadAdminList("doctors")
            "admin_verification" -> loadAdminList("verification")
            "admin_facilities" -> loadAdminList("facilities")
            "admin_appointments" -> loadAdminList("appointments")
            "admin_patients" -> loadAdminList("patients")
            "admin_reviews" -> loadAdminList("reviews")
            "admin_specialties" -> loadAdminList("specialties")
            "admin_availability" -> loadAvailability(true)
            "admin_support" -> loadAdminList("support")
            "admin_deactivation" -> loadAdminList("deactivation")
            "login" -> showLogin()
            "signup" -> showRegistration()
            "doctor_login" -> showLogin(portal = "doctor")
            else -> if(role=="doctor")loadDoctorDashboard() else if(role=="admin")loadAdminOverview() else loadDoctors()
        }
    }

    private fun homeTab(): String = when (user.optString("role")) {
        "doctor" -> "doctor_dashboard"
        "admin" -> "admin_overview"
        else -> "discover"
    }

    private fun startEvents() {
        if (eventsActive || user.optString("role") !in listOf("patient", "doctor", "admin")) return
        eventsActive = true
        eventsWorker.execute {
            CarewellApi.watchEvents({ eventsActive }) {
                runOnUiThread {
                    if (!eventsActive || isFinishing) return@runOnUiThread
                    val conversation = activeConversationId
                    if (activeTab == "messages" && conversation != null) showConversation(conversation, activeConversationTitle)
                    else showHome(activeTab)
                }
            }
        }
    }

    private fun stopEvents() { eventsActive = false; CarewellApi.stopWatchingEvents() }

    private fun loadDiscover() {
        content.removeAllViews()
        content.addView(label("Care that fits your life", 26, ink, true))
        content.addView(label("Find trusted doctors, compare clinics and request an appointment when you are ready.", 15, muted))
        val search = field("Search by doctor, specialty or area")
        content.addView(search)
        content.addView(action("Find a doctor").apply { setOnClickListener { loadDoctors(search.text.toString()) } })
        content.addView(action("Browse hospitals and clinics").apply { setOnClickListener { showHome("facilities") } })
        content.addView(label("Browse specialties", 19, ink, true))
        val specialtyList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(specialtyList)
        runApi({ CarewellApi.get("/specialties") as JSONArray }) { result ->
            if (result.isSuccess) {
                val items = result.getOrThrow() as JSONArray
                for (i in 0 until minOf(items.length(), 20)) {
                    val item = items.getJSONObject(i)
                    specialtyList.addView(action(item.optString("name")).apply {
                        setOnClickListener { loadDoctors(specialtyId = item.optString("id")) }
                    })
                }
            }
        }
        content.addView(label("Featured doctors", 19, ink, true))
        runApi({ CarewellApi.get("/doctors") as JSONArray }) { result ->
            if (result.isFailure) { content.addView(note(result.exceptionOrNull()?.message ?: "Could not load doctors.")); return@runApi }
            val items = result.getOrThrow() as JSONArray
            for (i in 0 until minOf(items.length(), 6)) content.addView(doctorCard(items.getJSONObject(i)))
            if (items.length() == 0) content.addView(note("No published doctors are available yet."))
        }
        content.addView(label("How Carewell works", 19, ink, true))
        content.addView(note("1. Find a doctor and choose a clinic.  2. Select an available time.  3. Send a request and follow its status in Visits."))
        content.addView(action("Contact Carewell support").apply { setOnClickListener { showHome("assistance") } })
    }

    private fun loadDoctors(search: String = "", specialtyId: String = "", savedOnly: Boolean = false, location: String = "") {
        content.removeAllViews()
        content.addView(label(if (savedOnly) "Saved doctors" else "Find a doctor", 22, ink, true))
        if (savedOnly) content.addView(note("Your saved doctors are stored on this device."))
        val query = field("Doctor, specialty, or location")
        val specialty=field("Selected specialty ID"); specialty.setText(specialtyId)
        val locationFilter=field("City or area"); locationFilter.setText(location)
        val maxFee=field("Maximum fee in BDT",android.text.InputType.TYPE_CLASS_NUMBER)
        val minExperience=field("Minimum experience in years",android.text.InputType.TYPE_CLASS_NUMBER)
        val language=field("Language spoken (optional)")
        val availability=field("Available: Today, Tomorrow or This week")
        val sort=field("Sort: recommended, fee-low, experience or rating")
        val verified=CheckBox(this).apply { text=translate("Platform verified only") }
        query.setText(search)
        val searchButton = action("Search")
        content.addView(query)
        content.addView(specialty);content.addView(locationFilter);content.addView(maxFee);content.addView(minExperience);content.addView(language);content.addView(availability);content.addView(verified);content.addView(sort)
        content.addView(searchButton)
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        fun request() {
            results.removeAllViews()
            results.addView(label("Loading doctors…", 15, muted))
            runApi({ CarewellApi.get(CarewellApi.query("/doctors", mapOf("query" to query.text.toString().trim(),"specialty" to specialty.text.toString().trim(),"location" to locationFilter.text.toString().trim(),"maxFee" to maxFee.text.toString().trim(),"available" to availability.text.toString().trim(),"verified" to if(verified.isChecked)"true" else ""))) as JSONArray }) { response ->
                results.removeAllViews()
                if (response.isFailure) {
                    results.addView(note(response.exceptionOrNull()?.message ?: "Could not load doctors."))
                    return@runApi
                }
                doctors = response.getOrThrow() as JSONArray
                val saved = savedDoctorIds()
                val minYears = minExperience.text.toString().toIntOrNull() ?: 0
                val lang = language.text.toString().trim().lowercase(Locale.ROOT)
                val matches = (0 until doctors.length()).map { doctors.getJSONObject(it) }
                    .filter { it.optInt("experienceYears") >= minYears }
                    .filter { d -> lang.isBlank() || (d.optJSONArray("languages") ?: JSONArray()).let { a -> (0 until a.length()).any { a.optString(it).lowercase(Locale.ROOT).contains(lang) } } }
                    .filter { !savedOnly || saved.contains(it.optString("id")) }
                    .let { list -> when(sort.text.toString().trim().lowercase(Locale.ROOT)) {
                        "fee-low" -> list.sortedBy { it.optInt("fee") }
                        "experience" -> list.sortedByDescending { it.optInt("experienceYears") }
                        "rating" -> list.sortedByDescending { it.optDouble("rating") }
                        else -> list
                    } }
                if (matches.isEmpty()) results.addView(label(if(savedOnly)"No saved doctors yet. Save a doctor from their profile." else "No doctors matched. Try another search.", 15, muted))
                matches.forEach { results.addView(doctorCard(it)) }
            }
        }
        content.addView(label("Choose a specialty",16,ink,true))
        val specialtyChoices=LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL }
        content.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled=false; addView(specialtyChoices) })
        runApi({CarewellApi.get("/specialties") as JSONArray}) { result ->
            if(result.isSuccess) {
                val items=result.getOrThrow() as JSONArray
                for(i in 0 until items.length()) {
                    val item=items.getJSONObject(i)
                    specialtyChoices.addView(action(item.optString("name")).apply { setOnClickListener { specialty.setText(item.optString("id")); request() } })
                }
            }
        }
        content.addView(results)
        searchButton.setOnClickListener { request() }
        request()
    }

    private fun savedDoctorIds(): MutableSet<String> = try {
        val values = JSONArray(getSharedPreferences("carewell_favorites", MODE_PRIVATE).getString("ids", "[]"))
        (0 until values.length()).map { values.optString(it) }.filter { it.isNotBlank() }.toMutableSet()
    } catch (_: Exception) { mutableSetOf() }

    private fun doctorCard(doctor: JSONObject): LinearLayout {
        val box = card()
        if(doctor.optString("image").isNotBlank()) box.addView(remoteImage(doctor.optString("image")))
        box.addView(label(doctor.optString("name"), 18, ink, true))
        box.addView(label("${doctor.optString("specialty")} · ${doctor.optInt("experienceYears")} years' experience", 14, muted))
        box.addView(label("${doctor.optString("location")} · BDT ${doctor.optInt("fee")}", 14, muted))
        val languages = doctor.optJSONArray("languages") ?: JSONArray()
        if (languages.length() > 0) box.addView(label("Languages: ${(0 until languages.length()).joinToString(", ") { languages.optString(it) }}", 14, muted))
        box.addView(label("${doctor.optDouble("rating")} ★ · ${doctor.optInt("reviewCount")} reviews · ${doctor.optString("nextAvailable", "To be scheduled")}", 14, teal))
        val saved = savedDoctorIds()
        box.addView(action(if(saved.contains(doctor.optString("id")))"♥  Saved doctor" else "♡  Save doctor").apply {
            setOnClickListener {
                val id = doctor.optString("id")
                if(!saved.add(id)) saved.remove(id)
                val values = JSONArray(); saved.forEach { values.put(it) }
                getSharedPreferences("carewell_favorites", MODE_PRIVATE).edit().putString("ids", values.toString()).apply()
                if(activeTab=="favorites") loadDoctors(savedOnly=true) else text=if(saved.contains(id))"♥  Saved doctor" else "♡  Save doctor"
            }
        })
        box.addView(action("View profile, reviews and appointment times").apply { setOnClickListener { openDoctor(doctor) } })
        return box
    }

    private fun loadFacilities(filterQuery: String = "", filterType: String = "all") {
        content.removeAllViews()
        content.addView(label("Clinics and hospitals", 22, ink, true))
        val query = field("Search by clinic or area"); query.setText(filterQuery); content.addView(query)
        val kind = field("Type: all, clinic or hospital"); kind.setText(filterType); content.addView(kind)
        content.addView(action("Search locations").apply { setOnClickListener { loadFacilities(query.text.toString(), kind.text.toString()) } })
        runApi({ CarewellApi.get("/clinics") as JSONArray }) { result ->
            if (result.isFailure) { content.addView(note(result.exceptionOrNull()?.message ?: "Could not load clinics.")); return@runApi }
            val items = result.getOrThrow() as JSONArray
            val term = filterQuery.trim().lowercase(Locale.ROOT)
            val type = filterType.trim().lowercase(Locale.ROOT)
            var count = 0
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val searchable = "${item.optString("name")} ${item.optString("area")} ${item.optString("city")}".lowercase(Locale.ROOT)
                if (type !in listOf("", "all") && !item.optString("type").equals(type, true)) continue
                if (!searchable.contains(term)) continue
                count++
                val box = card()
                if(item.optString("image").isNotBlank()) box.addView(remoteImage(item.optString("image")))
                box.addView(label(item.optString("name"), 18, ink, true))
                box.addView(label("${item.optString("type").replaceFirstChar { it.uppercase() }} · ${item.optString("area")}, ${item.optString("city")}", 14, muted))
                box.addView(label(item.optString("address"), 14, muted))
                box.addView(label(item.optString("phone"), 14, teal))
                box.addView(action("View doctors at this location").apply { setOnClickListener { loadDoctors(location = item.optString("name")) } })
                box.addView(action("Open directions in Maps").apply {
                    setOnClickListener {
                        val place = Uri.encode("${item.optString("address")}, ${item.optString("area")}, ${item.optString("city")}")
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=$place")))
                    }
                })
                content.addView(box)
            }
            if (count == 0) content.addView(note("No clinics or hospitals match those filters."))
        }
    }

    private fun showAssistance() {
        content.removeAllViews()
        content.addView(label("How can we help?", 22, ink, true))
        content.addView(label("Send a message to the Carewell support team.", 14, muted))
        val email = field("Email (optional)", android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        email.setText(user.optString("email"))
        val message = field("Tell us what you need help with")
        message.minLines = 4
        content.addView(email); content.addView(message)
        content.addView(action("Send to support").apply {
            setOnClickListener {
                isEnabled = false
                runApi({ CarewellApi.post("/support-requests", JSONObject().put("email", email.text.toString().trim()).put("message", message.text.toString().trim())) }) { result ->
                    isEnabled = true
                    content.addView(note(if (result.isSuccess) "Your message was sent to Carewell support." else result.exceptionOrNull()?.message ?: "Could not send the message."))
                }
            }
        })
    }

    private fun loadConversations() {
        activeConversationId = null
        content.removeAllViews()
        content.addView(label("Messages", 22, ink, true))
        runApi({ CarewellApi.get("/conversations") as JSONArray }) { result ->
            if (result.isFailure) { content.addView(note(result.exceptionOrNull()?.message ?: "Could not load messages.")); return@runApi }
            val items = result.getOrThrow() as JSONArray
            if (items.length() == 0) content.addView(note("No conversations yet. Patient and doctor conversations are available after an appointment is accepted."))
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val open = action("${item.optString("participantName")} · ${item.optInt("unread")} unread")
                content.addView(open)
                open.setOnClickListener { showConversation(item.optString("id"), item.optString("participantName")) }
            }
        }
        if (user.optString("role") == "admin") {
            content.addView(label("Open a doctor conversation", 17, ink, true))
            val doctorId = field("Doctor profile ID")
            content.addView(doctorId)
            content.addView(action("Open conversation").apply {
                setOnClickListener { runApi({ CarewellApi.post("/conversations", JSONObject().put("doctorId", doctorId.text.toString().trim())) as JSONObject }) { if (it.isSuccess) { val v=it.getOrThrow() as JSONObject; showConversation(v.optString("id"), v.optString("participantName")) } else content.addView(note(it.exceptionOrNull()?.message ?: "Could not open conversation.")) } }
            })
        }
    }

    private fun showConversation(id: String, title: String) {
        activeConversationId = id
        activeConversationTitle = title
        content.removeAllViews()
        content.addView(action("‹  Back to messages").apply { setOnClickListener { showHome("messages") } })
        content.addView(label(title, 21, ink, true))
        val thread = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(thread)
        runApi({ CarewellApi.get("/conversations/$id/messages") as JSONArray }) { result ->
            if (result.isFailure) { thread.addView(note(result.exceptionOrNull()?.message ?: "Could not load conversation.")); return@runApi }
            val messages = result.getOrThrow() as JSONArray
            for (i in 0 until messages.length()) {
                val message = messages.getJSONObject(i)
                thread.addView(note("${if (message.optBoolean("isMine")) "You" else title}: ${message.optString("body")}"))
            }
        }
        val input = field("Write a message")
        input.minLines = 2
        content.addView(input)
        content.addView(action("Attach a file").apply{setOnClickListener{chooseCertificate("/conversations/$id/attachments")}})
        content.addView(action("Send message").apply {
            setOnClickListener { val body=input.text.toString().trim(); if (body.isNotEmpty()) runApi({ CarewellApi.post("/conversations/$id/messages", JSONObject().put("body", body)) }) { if (it.isSuccess) showConversation(id,title) else content.addView(note(it.exceptionOrNull()?.message ?: "Could not send message.")) } }
        })
    }

    private fun loadNotifications() {
        content.removeAllViews()
        content.addView(label("Notifications", 22, ink, true))
        content.addView(action("Mark all as read").apply { setOnClickListener { runApi({ CarewellApi.post("/notifications/read-all", JSONObject()) }) { loadNotifications() } } })
        runApi({ CarewellApi.get("/notifications?limit=50") as JSONObject }) { result ->
            if (result.isFailure) { content.addView(note(result.exceptionOrNull()?.message ?: "Could not load notifications.")); return@runApi }
            val items = (result.getOrThrow() as JSONObject).optJSONArray("items") ?: JSONArray()
            if (items.length() == 0) content.addView(note("You have no notifications."))
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val box = card()
                box.addView(label(item.optString("title"), 17, ink, true))
                box.addView(label(item.optString("body"), 14, muted))
                if (!item.optBoolean("read")) box.addView(action("Mark read").apply { setOnClickListener { runApi({ CarewellApi.post("/notifications/${item.optString("id")}/read", JSONObject()) }) { loadNotifications() } } })
                content.addView(box)
            }
        }
    }

    private fun loadDoctorDashboard() {
        content.removeAllViews()
        content.addView(label("Doctor workspace", 22, ink, true))
        runApi({ CarewellApi.get("/doctor/profile") as JSONObject }) { profile ->
            if (profile.isSuccess) {
                val doctor = profile.getOrThrow() as JSONObject
                content.addView(note("${doctor.optString("name")} · ${doctor.optString("specialty")} · ${doctor.optString("onboardingStatus")}"))
            } else content.addView(note(profile.exceptionOrNull()?.message ?: "Doctor profile is not available."))
        }
        content.addView(label("Appointment requests", 18, ink, true))
        content.addView(action("Request account deactivation").apply{setOnClickListener{simpleInput("Why do you want to deactivate your account?"){reason->runApi({CarewellApi.post("/doctor/account/deactivation-requests",JSONObject().put("reason",reason))}){if(it.isSuccess)content.addView(note("Your deactivation request was sent."))else content.addView(note(it.exceptionOrNull()?.message?:"Could not send request."))}}}})
        runApi({ CarewellApi.get("/doctor/appointments") as JSONArray }) { result ->
            if (result.isFailure) { content.addView(note(result.exceptionOrNull()?.message ?: "Could not load requests.")); return@runApi }
            val visits = result.getOrThrow() as JSONArray
            if (visits.length() == 0) content.addView(note("No appointment requests yet."))
            for (i in 0 until visits.length()) {
                val item = visits.getJSONObject(i)
                val box = card()
                box.addView(label(item.optString("patientName"), 17, ink, true))
                box.addView(label("${item.optString("date")} · ${item.optString("time")} · ${item.optString("status")}", 14, teal))
                box.addView(label("${item.optString("reason")} · ${item.optString("phone")}", 14, muted))
                when (item.optString("status")) {
                    "pending" -> {
                        box.addView(action("Accept").apply { setOnClickListener { updateDoctorVisit(item,"accepted") } })
                        box.addView(action("Reject").apply { setOnClickListener { updateDoctorVisit(item,"rejected") } })
                    }
                    "accepted" -> box.addView(action("Mark completed").apply { setOnClickListener { updateDoctorVisit(item,"completed") } })
                }
                content.addView(box)
            }
        }
    }

    private fun updateDoctorVisit(visit: JSONObject, status: String) {
        runApi({ CarewellApi.patch("/doctor/appointments/${visit.optString("id")}", JSONObject().put("status", status)) }) {
            if (it.isSuccess) loadDoctorDashboard() else content.addView(note(it.exceptionOrNull()?.message ?: "Could not update the request."))
        }
    }

    private fun loadDoctorApplication() {
        content.removeAllViews()
        content.addView(label("Doctor application", 22, ink, true))
        runApi({ CarewellApi.get("/doctor/application") as JSONObject }) { result ->
            if (result.isFailure) { content.addView(note(result.exceptionOrNull()?.message ?: "Application unavailable.")); return@runApi }
            val application = result.getOrThrow() as JSONObject
            content.addView(note(application.toString(2)))
            val status = application.optString("status", application.optString("onboardingStatus"))
            uploadKind="bmdc"
            content.addView(action("Upload BMDC registration certificate").apply{setOnClickListener{uploadKind="bmdc";chooseCertificate("/doctor/certificates")}})
            content.addView(action("Upload degree or other certificate").apply{setOnClickListener{uploadKind="degree";chooseCertificate("/doctor/certificates")}})
            val certificates=application.optJSONArray("certificates")?:JSONArray()
            for(i in 0 until certificates.length()){val certificate=certificates.getJSONObject(i);content.addView(action("${certificate.optString("kind").uppercase()}: ${certificate.optString("fileName")} · remove").apply{setOnClickListener{runApi({CarewellApi.delete("/doctor/certificates/${certificate.optString("id")}")}){loadDoctorApplication()}}})}
            if (status in listOf("in_progress", "changes_requested"))
                content.addView(action("Submit application for review").apply { setOnClickListener { runApi({ CarewellApi.post("/doctor/application/submit", JSONObject()) }) { loadDoctorApplication() } } })
            if (status == "rejected")
                content.addView(action("Reopen application").apply { setOnClickListener { runApi({ CarewellApi.post("/doctor/application/reopen", JSONObject()) }) { loadDoctorApplication() } } })
        }
        content.addView(label("Update professional profile", 18, ink, true))
        content.addView(action("Edit doctor profile").apply { setOnClickListener { editDoctorProfile() } })
    }

    private fun editDoctorProfile() {
        content.removeAllViews()
        content.addView(label("Edit professional profile", 22, ink, true))
        runApi({ CarewellApi.get("/doctor/profile") as JSONObject }) { result ->
            if (result.isFailure) { content.addView(note(result.exceptionOrNull()?.message ?: "Profile unavailable.")); return@runApi }
            val profile = result.getOrThrow() as JSONObject
            val name = field("Full name"); name.setText(profile.optString("name"))
            val specialty = field("Specialty ID"); specialty.setText(profile.optString("specialtyId"))
            val qualifications = field("Qualifications (comma separated)"); qualifications.setText(profile.optJSONArray("qualifications")?.let { a -> (0 until a.length()).joinToString(", ") { a.optString(it) } } ?: "")
            val years = field("Years of experience", android.text.InputType.TYPE_CLASS_NUMBER); years.setText(profile.optString("experienceYears"))
            val fee = field("Fee in BDT", android.text.InputType.TYPE_CLASS_NUMBER); fee.setText(profile.optString("fee"))
            val location = field("Practice location"); location.setText(profile.optString("location"))
            val facilities = field("Clinic IDs (comma separated)"); facilities.setText(profile.optJSONArray("facilityIds")?.let { a -> (0 until a.length()).joinToString(", ") { a.optString(it) } } ?: "")
            listOf(name,specialty,qualifications,years,fee,location,facilities).forEach { content.addView(it) }
            content.addView(action("Save doctor profile").apply {
                setOnClickListener {
                    val list = JSONArray(); qualifications.text.toString().split(",").map { it.trim() }.filter { it.isNotEmpty() }.forEach { list.put(it) }
                    val clinicIds = JSONArray(); facilities.text.toString().split(",").map { it.trim() }.filter { it.isNotEmpty() }.forEach { clinicIds.put(it) }
                    val body = JSONObject().put("name",name.text.toString().trim()).put("specialtyId",specialty.text.toString().trim())
                        .put("qualifications",list).put("experienceYears",years.text.toString().toIntOrNull() ?: 0)
                        .put("fee",fee.text.toString().toIntOrNull() ?: 0).put("location",location.text.toString().trim()).put("facilityIds",clinicIds)
                    runApi({ CarewellApi.patch("/doctor/profile",body) }) { if (it.isSuccess) loadDoctorApplication() else content.addView(note(it.exceptionOrNull()?.message ?: "Could not save profile.")) }
                }
            })
        }
    }

    private fun loadAvailability(admin: Boolean) {
        content.removeAllViews()
        content.addView(label(if (admin) "Manage availability" else "Your availability", 22, ink, true))
        val doctorId = if (admin) field("Doctor profile ID") else null
        if (doctorId != null) { doctorId.setText(user.optString("doctorId")); content.addView(doctorId) }
        val facility = field("Clinic ID")
        val date = field("Date (YYYY-MM-DD)"); date.setText(today())
        val start = field("Start time (HH:mm)")
        val end = field("End time (HH:mm)")
        content.addView(facility); content.addView(date); content.addView(start); content.addView(end)
        val create = action("Add availability window")
        content.addView(create)
        create.setOnClickListener {
            val body = JSONObject().put("facilityId",facility.text.toString().trim()).put("date",date.text.toString().trim()).put("startTime",start.text.toString().trim()).put("endTime",end.text.toString().trim())
            if (admin) body.put("doctorId",doctorId?.text?.toString()?.trim())
            runApi({ CarewellApi.post(if (admin) "/admin/availability" else "/doctor/availability",body) }) { if (it.isSuccess) loadAvailability(admin) else content.addView(note(it.exceptionOrNull()?.message ?: "Could not add availability.")) }
        }
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(list)
        if (!admin) refreshAvailability(list,"/doctor/availability",false)
        else content.addView(action("Load this doctor's slots").apply { setOnClickListener { refreshAvailability(list,CarewellApi.query("/admin/availability",mapOf("doctorId" to (doctorId?.text?.toString() ?: ""))),true) } })
    }

    private fun refreshAvailability(list: LinearLayout, path: String, admin: Boolean) {
        list.removeAllViews()
        runApi({ CarewellApi.get(path) as JSONArray }) { result ->
            if (result.isFailure) { list.addView(note(result.exceptionOrNull()?.message ?: "Could not load availability.")); return@runApi }
            val slots = result.getOrThrow() as JSONArray
            for (i in 0 until slots.length()) {
                val slot=slots.getJSONObject(i); val row=card()
                row.addView(label("${slot.optString("date")} · ${slot.optString("startTime")}–${slot.optString("endTime")} · ${slot.optString("status")}",15,ink))
                val scope = if(admin)"/admin" else "/doctor"
                row.addView(action(if(slot.optString("status")=="unavailable")"Unblock slot" else "Block slot").apply {
                    setOnClickListener {
                        val status=if(slot.optString("status")=="unavailable")"available" else "unavailable"
                        runApi({CarewellApi.patch("$scope/availability/${slot.optString("id")}",JSONObject().put("status",status))}) { refreshAvailability(list,path,admin) }
                    }
                })
                row.addView(action("Edit slot").apply { setOnClickListener { editAvailability(slot,list,path,admin) } })
                row.addView(action("Remove slot").apply { setOnClickListener { runApi({ CarewellApi.delete("${if(admin) "/admin" else "/doctor"}/availability/${slot.optString("id")}") }) { refreshAvailability(list,path,admin) } } })
                list.addView(row)
            }
        }
    }

    private fun editAvailability(slot:JSONObject,list:LinearLayout,path:String,admin:Boolean) {
        content.removeAllViews()
        content.addView(action("‹  Back to availability").apply { setOnClickListener { showHome(if(admin)"admin_availability" else "doctor_availability") } })
        content.addView(label("Edit availability slot",22,ink,true))
        val date=field("Date (YYYY-MM-DD)");date.setText(slot.optString("date"))
        val start=field("Start time (HH:mm)");start.setText(slot.optString("startTime"))
        val end=field("End time (HH:mm)");end.setText(slot.optString("endTime"))
        content.addView(date);content.addView(start);content.addView(end)
        content.addView(action("Save slot changes").apply {
            setOnClickListener {
                val body=JSONObject().put("date",date.text.toString().trim()).put("startTime",start.text.toString().trim()).put("endTime",end.text.toString().trim())
                runApi({CarewellApi.patch("${if(admin)"/admin" else "/doctor"}/availability/${slot.optString("id")}",body)}) { result ->
                    if(result.isSuccess) {
                        content.removeAllViews()
                        content.addView(action("‹  Back to availability").apply { setOnClickListener { showHome(if(admin)"admin_availability" else "doctor_availability") } })
                        content.addView(list)
                        refreshAvailability(list,path,admin)
                    } else content.addView(note(result.exceptionOrNull()?.message?:"Could not update slot."))
                }
            }
        })
    }

    private fun loadAdminOverview() {
        content.removeAllViews()
        content.addView(label("Administration overview", 22, ink, true))
        runApi({ CarewellApi.get("/admin/summary") as JSONObject }) { result ->
            if (result.isSuccess) content.addView(note((result.getOrThrow() as JSONObject).toString(2)))
            else content.addView(note(result.exceptionOrNull()?.message ?: "Could not load overview."))
        }
        content.addView(label("Choose a section in the navigation bar to review or update records.",14,muted))
    }

    private fun loadAdminList(section: String, searchQuery: String = "", patientStatus: String = "") {
        content.removeAllViews()
        val titles = mapOf("doctors" to "Doctor management", "verification" to "Verify applications", "facilities" to "Clinics and hospitals", "appointments" to "Appointment management", "patients" to "Patient management", "reviews" to "Review moderation", "specialties" to "Specialty management", "support" to "Support requests", "deactivation" to "Deactivation requests")
        content.addView(label(titles[section] ?: section,22,ink,true))
        if(section=="patients") {
            val query=field("Search patients by name or email");query.setText(searchQuery)
            val status=field("Status: all, active or suspended");status.setText(patientStatus.ifBlank { "all" })
            content.addView(query);content.addView(status)
            content.addView(action("Search patients").apply { setOnClickListener { loadAdminList("patients",query.text.toString().trim(),status.text.toString().trim()) } })
        }
        val path = when(section) {
            "doctors","verification" -> "/admin/doctors"
            "facilities" -> "/admin/clinics"
            "appointments" -> "/admin/appointments"
            "patients" -> CarewellApi.query("/admin/patients",mapOf("query" to searchQuery,"status" to patientStatus.takeIf { it!="all" }.orEmpty()))
            "reviews" -> "/admin/reviews"
            "specialties" -> "/admin/specialties"
            "support" -> "/admin/support-requests"
            else -> "/admin/deactivation-requests?status=open"
        }
        runApi({ CarewellApi.get(path) as JSONArray }) { result ->
            if (result.isFailure) { content.addView(note(result.exceptionOrNull()?.message ?: "Could not load records.")); return@runApi }
            val rows = result.getOrThrow() as JSONArray
            if (rows.length() == 0) content.addView(note("No records found."))
            for (i in 0 until rows.length()) renderAdminRecord(section,rows.getJSONObject(i))
        }
        if (section == "doctors") content.addView(action("Invite a doctor").apply { setOnClickListener { createDoctorForm() } })
        if (section == "facilities") content.addView(action("Add a facility").apply { setOnClickListener { createFacilityForm() } })
        if (section == "specialties") content.addView(action("Add a specialty").apply { setOnClickListener { createSpecialtyForm() } })
    }

    private fun renderAdminRecord(section: String, item: JSONObject) {
        val box=card()
        val title=item.optString("name",item.optString("patientName",item.optString("doctorName",item.optString("title",item.optString("id")))))
        box.addView(label(title,17,ink,true))
        val summary=when(section) {
            "doctors","verification" -> "${item.optString("specialty")} · ${item.optString("onboardingStatus")} · ${item.optString("verificationStatus")} · ${item.optString("publicationStatus")}"
            "facilities" -> "${item.optString("type")} · ${item.optString("area")}, ${item.optString("city")} · ${if(item.optBoolean("active",true)) "active" else "inactive"}"
            "appointments" -> "${item.optString("date")} · ${item.optString("time")} · ${item.optString("status")} · ${item.optString("patientName")}"
            "patients" -> "${item.optString("email")} · ${item.optString("accountStatus")} · ${item.optInt("appointmentCount")} appointments"
            "reviews" -> "${item.optInt("rating")} ★ · ${item.optString("status")} · ${item.optString("comment")}"
            "specialties" -> "${item.optString("slug")} · ${if(item.optBoolean("active",true)) "active" else "inactive"}"
            "support" -> "${item.optString("status")} · ${item.optString("message")}"
            else -> "${item.optString("status")} · ${item.optString("reason")}"
        }
        box.addView(label(summary,14,muted))
        val id=item.optString("id")
        when(section) {
            "doctors" -> {
                box.addView(action("Edit doctor profile").apply{setOnClickListener{editAdminDoctor(item)}})
                box.addView(action("Set verification status").apply {
                    setOnClickListener {
                        simpleInput("Enter pending, verified, rejected or suspended") { status ->
                            if(status !in listOf("pending","verified","rejected","suspended")) box.addView(note("Choose one of the listed verification statuses."))
                            else runApi({CarewellApi.patch("/admin/doctors/$id/verification",JSONObject().put("status",status))}) { result -> if(result.isSuccess)loadAdminList(section) else box.addView(note(result.exceptionOrNull()?.message?:"Could not update verification.")) }
                        }
                    }
                })
                box.addView(action("Resend invitation").apply { setOnClickListener { runApi({ CarewellApi.post("/admin/doctors/$id/invitation",JSONObject()) }) { if(it.isSuccess) loadAdminList(section) else box.addView(note(it.exceptionOrNull()?.message ?: "Failed.")) } } })
                box.addView(action("Upload BMDC certificate for doctor").apply{setOnClickListener{uploadKind="bmdc";chooseCertificate("/admin/doctors/$id/certificates")}})
                box.addView(action("Deactivate doctor account").apply{setOnClickListener{confirmAction("Deactivate this doctor?","Their profile will be removed from the public directory."){runApi({CarewellApi.post("/admin/doctors/$id/deactivation",JSONObject())}){loadAdminList(section)}}}})
                box.addView(action(if(item.optString("publicationStatus")=="published")"Unpublish doctor" else "Publish doctor").apply { setOnClickListener { val value=if(item.optString("publicationStatus")=="published") "unpublished" else "published"; confirmAction(if(value=="published")"Publish this doctor?" else "Unpublish this doctor?","This changes whether patients can find the profile."){runApi({ CarewellApi.patch("/admin/doctors/$id/publication",JSONObject().put("status",value)) }) { result -> if(result.isSuccess)loadAdminList(section) else box.addView(note(result.exceptionOrNull()?.message?:"Could not update publication.")) } } } })
            }
            "verification" -> {
                box.addView(action("Upload BMDC certificate for doctor").apply{setOnClickListener{uploadKind="bmdc";chooseCertificate("/admin/doctors/$id/certificates")}})
                box.addView(action("Record BMDC mismatch").apply{setOnClickListener{simpleInput("Explain the BMDC mismatch"){noteText->runApi({CarewellApi.patch("/admin/doctors/$id/bmdc-check",JSONObject().put("result","mismatch").put("note",noteText))}){loadAdminList(section)}}}})
                box.addView(action("Record BMDC number not found").apply{setOnClickListener{simpleInput("Add a note for the record"){noteText->runApi({CarewellApi.patch("/admin/doctors/$id/bmdc-check",JSONObject().put("result","not_found").put("note",noteText))}){loadAdminList(section)}}}})
                box.addView(action("Record BMDC match").apply { setOnClickListener { runApi({ CarewellApi.patch("/admin/doctors/$id/bmdc-check",JSONObject().put("result","matched")) }) { if(it.isSuccess) runApi({ CarewellApi.post("/admin/doctors/$id/application/approve",JSONObject()) }) { loadAdminList(section) } else box.addView(note(it.exceptionOrNull()?.message ?: "Failed.")) } } })
                box.addView(action("Request changes").apply { setOnClickListener { simpleInput("What should the doctor change?") { note -> runApi({ CarewellApi.post("/admin/doctors/$id/application/request-changes",JSONObject().put("note",note)) }) { loadAdminList(section) } } } })
                box.addView(action("Reject application").apply { setOnClickListener { simpleInput("Reason for rejection") { note -> runApi({ CarewellApi.post("/admin/doctors/$id/application/reject",JSONObject().put("note",note)) }) { loadAdminList(section) } } } })
            }
            "facilities" -> {
                box.addView(action("Edit facility").apply { setOnClickListener { editFacilityForm(item) } })
                if(item.optBoolean("active",true)) box.addView(action("Deactivate facility").apply { setOnClickListener { confirmAction("Deactivate this facility?","Patients will no longer see it when booking."){runApi({ CarewellApi.post("/admin/clinics/$id/deactivation",JSONObject()) }) { loadAdminList(section) }} } })
            }
            "appointments" -> when(item.optString("status")) { "pending" -> {box.addView(action("Accept appointment").apply { setOnClickListener { setAdminAppointment(id,"accepted") } });box.addView(action("Reject appointment").apply{setOnClickListener{setAdminAppointment(id,"rejected")}});box.addView(action("Cancel appointment").apply { setOnClickListener { setAdminAppointment(id,"cancelled") } })};"accepted" -> {box.addView(action("Mark completed").apply{setOnClickListener{setAdminAppointment(id,"completed")}});box.addView(action("Cancel appointment").apply{setOnClickListener{setAdminAppointment(id,"cancelled")}})} }
            "patients" -> box.addView(action(if(item.optString("accountStatus")=="suspended") "Restore patient" else "Suspend patient").apply { val status=if(item.optString("accountStatus")=="suspended") "active" else "suspended"; setOnClickListener { confirmAction(if(status=="active")"Restore this patient?" else "Suspend this patient?","This changes the patient's ability to sign in."){runApi({ CarewellApi.patch("/admin/patients/$id/status",JSONObject().put("status",status)) }) { loadAdminList(section) }} } })
            "reviews" -> box.addView(action(if(item.optString("status")=="hidden") "Restore review" else "Hide review").apply { val status=if(item.optString("status")=="hidden") "visible" else "hidden"; setOnClickListener { confirmAction(if(status=="hidden")"Hide this review?" else "Restore this review?","This changes whether the review is shown publicly."){runApi({ CarewellApi.patch("/admin/reviews/$id",JSONObject().put("status",status)) }) { loadAdminList(section) }} } })
            "specialties" -> box.addView(action("Toggle active").apply { setOnClickListener { runApi({ CarewellApi.patch("/admin/specialties/$id",JSONObject().put("active",!item.optBoolean("active",true))) }) { loadAdminList(section) } } })
            "support" -> { box.addView(action("Mark in progress").apply{setOnClickListener{runApi({CarewellApi.patch("/admin/support-requests/$id",JSONObject().put("status","in_progress"))}){loadAdminList(section)}}});box.addView(action("Mark resolved").apply { setOnClickListener { runApi({ CarewellApi.patch("/admin/support-requests/$id",JSONObject().put("status","resolved")) }) { loadAdminList(section) } } }); box.addView(action("Reply").apply { setOnClickListener { simpleInput("Reply to this request") { reply -> runApi({ CarewellApi.post("/admin/support-requests/$id/reply",JSONObject().put("message",reply)) }) { loadAdminList(section) } } } }) }
            "deactivation" -> { box.addView(action("Approve deactivation").apply { setOnClickListener { runApi({ CarewellApi.post("/admin/deactivation-requests/$id/approve",JSONObject()) }) { loadAdminList(section) } } }); box.addView(action("Decline deactivation").apply { setOnClickListener { runApi({ CarewellApi.post("/admin/deactivation-requests/$id/decline",JSONObject()) }) { loadAdminList(section) } } }) }
        }
        content.addView(box)
    }

    private fun setAdminAppointment(id:String,status:String) { runApi({ CarewellApi.patch("/admin/appointments/$id",JSONObject().put("status",status)) }) { showHome("admin_appointments") } }

    private fun simpleInput(title:String, submit:(String)->Unit) {
        val input=field(title); content.addView(input)
        content.addView(action("Submit").apply { setOnClickListener { submit(input.text.toString().trim()) } })
    }

    private fun createDoctorForm() {
        content.removeAllViews(); content.addView(label("Invite a doctor",22,ink,true))
        val name=field("Doctor name"); val email=field("Doctor email",android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        val specialty=field("Specialty ID"); val qualifications=field("Qualifications separated by commas"); val years=field("Experience years",android.text.InputType.TYPE_CLASS_NUMBER)
        val fee=field("Fee in BDT",android.text.InputType.TYPE_CLASS_NUMBER); val location=field("Location"); val clinicIds=field("Clinic IDs separated by commas")
        listOf(name,email,specialty,qualifications,years,fee,location,clinicIds).forEach { content.addView(it) }
        content.addView(action("Send invitation").apply { setOnClickListener { val q=JSONArray(); qualifications.text.toString().split(",").map{it.trim()}.filter{it.isNotEmpty()}.forEach{q.put(it)}; val c=JSONArray(); clinicIds.text.toString().split(",").map{it.trim()}.filter{it.isNotEmpty()}.forEach{c.put(it)}; val body=JSONObject().put("name",name.text.toString()).put("email",email.text.toString()).put("specialtyId",specialty.text.toString()).put("qualifications",q).put("experienceYears",years.text.toString().toIntOrNull()?:0).put("fee",fee.text.toString().toIntOrNull()?:0).put("location",location.text.toString()).put("facilityIds",c); runApi({CarewellApi.post("/admin/doctors",body)}) { if(it.isSuccess) loadAdminList("doctors") else content.addView(note(it.exceptionOrNull()?.message?:"Could not invite doctor.")) } } })
    }

    private fun editAdminDoctor(item:JSONObject) {
        content.removeAllViews();content.addView(label("Edit doctor profile",22,ink,true))
        val name=field("Doctor name");name.setText(item.optString("name"));val specialty=field("Specialty ID");specialty.setText(item.optString("specialtyId"))
        val qualifications=field("Qualifications, comma separated");qualifications.setText(item.optJSONArray("qualifications")?.let{a->(0 until a.length()).joinToString(", "){a.optString(it)}}?:"")
        val years=field("Experience years",android.text.InputType.TYPE_CLASS_NUMBER);years.setText(item.optString("experienceYears"));val fee=field("Fee in BDT",android.text.InputType.TYPE_CLASS_NUMBER);fee.setText(item.optString("fee"));val location=field("Practice location");location.setText(item.optString("location"))
        val facilities=field("Clinic IDs, comma separated");facilities.setText(item.optJSONArray("facilityIds")?.let{a->(0 until a.length()).joinToString(", "){a.optString(it)}}?:"")
        listOf(name,specialty,qualifications,years,fee,location,facilities).forEach{content.addView(it)}
        content.addView(action("Save changes").apply {
            setOnClickListener {
                val qs = JSONArray()
                qualifications.text.toString().split(",").map { it.trim() }.filter { it.isNotEmpty() }.forEach { qs.put(it) }
                val fs = JSONArray()
                facilities.text.toString().split(",").map { it.trim() }.filter { it.isNotEmpty() }.forEach { fs.put(it) }
                val body = JSONObject()
                    .put("name", name.text.toString())
                    .put("specialtyId", specialty.text.toString())
                    .put("qualifications", qs)
                    .put("experienceYears", years.text.toString().toIntOrNull() ?: 0)
                    .put("fee", fee.text.toString().toIntOrNull() ?: 0)
                    .put("location", location.text.toString())
                    .put("facilityIds", fs)
                runApi({ CarewellApi.patch("/admin/doctors/${item.optString("id")}", body) }) { result ->
                    if (result.isSuccess) loadAdminList("doctors")
                    else content.addView(note(result.exceptionOrNull()?.message ?: "Could not update doctor."))
                }
            }
        })
    }

    private fun createFacilityForm() {
        content.removeAllViews(); content.addView(label("Add a clinic or hospital",22,ink,true))
        val name=field("Name"); val type=field("Type: clinic or hospital"); val address=field("Address"); val area=field("Area"); val city=field("City"); val phone=field("Phone")
        listOf(name,type,address,area,city,phone).forEach{content.addView(it)}
        content.addView(action("Save facility").apply{setOnClickListener{val body=JSONObject().put("name",name.text.toString()).put("type",type.text.toString()).put("address",address.text.toString()).put("area",area.text.toString()).put("city",city.text.toString()).put("phone",phone.text.toString());runApi({CarewellApi.post("/admin/clinics",body)}){if(it.isSuccess)loadAdminList("facilities")else content.addView(note(it.exceptionOrNull()?.message?:"Could not add facility."))}}})
    }

    private fun editFacilityForm(item:JSONObject) {
        content.removeAllViews();content.addView(label("Edit clinic or hospital",22,ink,true))
        val name=field("Name");name.setText(item.optString("name"))
        val type=field("Type: clinic or hospital");type.setText(item.optString("type"))
        val address=field("Address");address.setText(item.optString("address"))
        val area=field("Area");area.setText(item.optString("area"))
        val city=field("City");city.setText(item.optString("city"))
        val phone=field("Phone");phone.setText(item.optString("phone"))
        listOf(name,type,address,area,city,phone).forEach{content.addView(it)}
        content.addView(action("Save facility changes").apply {
            setOnClickListener {
                val body=JSONObject().put("name",name.text.toString().trim()).put("type",type.text.toString().trim()).put("address",address.text.toString().trim()).put("area",area.text.toString().trim()).put("city",city.text.toString().trim()).put("phone",phone.text.toString().trim())
                runApi({CarewellApi.patch("/admin/clinics/${item.optString("id")}",body)}) { result -> if(result.isSuccess)loadAdminList("facilities") else content.addView(note(result.exceptionOrNull()?.message?:"Could not update facility.")) }
            }
        })
    }

    private fun createSpecialtyForm() {
        content.removeAllViews(); content.addView(label("Add specialty",22,ink,true)); val name=field("Specialty name"); val slug=field("URL slug"); val description=field("Description"); content.addView(name);content.addView(slug);content.addView(description)
        content.addView(action("Save specialty").apply{setOnClickListener{runApi({CarewellApi.post("/admin/specialties",JSONObject().put("name",name.text.toString()).put("slug",slug.text.toString()).put("description",description.text.toString()))}){if(it.isSuccess)loadAdminList("specialties")else content.addView(note(it.exceptionOrNull()?.message?:"Could not save specialty."))}}})
    }

    private fun openDoctor(doctor: JSONObject) {
        selectedDoctor = doctor
        content.removeAllViews()
        content.addView(action("‹  Back to doctors").apply { setOnClickListener { showHome("doctors") } })
        if(doctor.optString("image").isNotBlank()) content.addView(remoteImage(doctor.optString("image")))
        content.addView(label(doctor.optString("name"), 24, ink, true))
        content.addView(label(doctor.optString("specialty"), 17, teal))
        content.addView(label(doctor.optString("qualifications"), 14, muted))
        content.addView(label("${doctor.optInt("experienceYears")} years' experience · BDT ${doctor.optInt("fee")}", 15, ink))
        content.addView(label("${doctor.optDouble("rating", 0.0)} ★ · ${doctor.optInt("reviewCount")} reviews", 14, muted))
        val languages = doctor.optJSONArray("languages") ?: JSONArray()
        if (languages.length() > 0) content.addView(label("Languages: ${(0 until languages.length()).joinToString(", ") { languages.optString(it) }}", 14, muted))
        content.addView(label("${doctor.optInt("completedVisits")} completed visits · ${doctor.optString("verificationStatus")}", 14, muted))
        content.addView(action("Read reviews").apply{setOnClickListener{loadDoctorReviews(doctor)}})
        val places = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(label("Choose a clinic", 19, ink, true))
        content.addView(places)
        runApi({ CarewellApi.get("/clinics") as JSONArray }) { result ->
            places.removeAllViews()
            if (result.isFailure) {
                places.addView(note(result.exceptionOrNull()?.message ?: "Could not load clinics."))
                return@runApi
            }
            clinics = result.getOrThrow() as JSONArray
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

    private fun loadDoctorReviews(doctor:JSONObject) {
        content.removeAllViews();content.addView(action("‹  Back to doctor").apply{setOnClickListener{openDoctor(doctor)}});content.addView(label("Reviews for ${doctor.optString("name")}",22,ink,true))
        runApi({CarewellApi.get("/doctors/${doctor.optString("id")}/reviews?limit=50") as JSONObject}){result->
            if(result.isFailure){content.addView(note(result.exceptionOrNull()?.message?:"Could not load reviews."));return@runApi}
            val data=result.getOrThrow() as JSONObject;val summary=data.optJSONObject("summary")?:JSONObject();content.addView(note("${summary.optDouble("average")} ★ · ${summary.optInt("count")} reviews"))
            val items=data.optJSONArray("items")?:JSONArray();if(items.length()==0)content.addView(note("No public reviews yet."))
            for(i in 0 until items.length()) {
                val review=items.getJSONObject(i)
                val box=card()
                box.addView(label("${review.optString("author")} · ${review.optInt("rating")} ★",16,ink,true))
                box.addView(label(review.optString("comment"),14,muted))
                if(review.optBoolean("mine")) {
                    box.addView(action("Edit my review").apply {
                        setOnClickListener {
                            val rating=field("Rating 1 to 5");rating.setText(review.optString("rating"))
                            val comment=field("Review");comment.setText(review.optString("comment"))
                            content.addView(rating);content.addView(comment)
                            content.addView(action("Save review").apply {
                                setOnClickListener { runApi({CarewellApi.patch("/reviews/${review.optString("id")}",JSONObject().put("rating",rating.text.toString().toIntOrNull()?:0).put("comment",comment.text.toString()))}) { loadDoctorReviews(doctor) } }
                            })
                        }
                    })
                    box.addView(action("Delete my review").apply { setOnClickListener { confirmAction("Delete your review?","This cannot be undone."){runApi({CarewellApi.delete("/reviews/${review.optString("id")}")}) { loadDoctorReviews(doctor) }} } })
                }
                content.addView(box)
            }
            val viewer=data.optJSONObject("viewer")?:JSONObject()
            if(viewer.optBoolean("canReview")){
                val rating=field("Rating from 1 to 5",android.text.InputType.TYPE_CLASS_NUMBER);val comment=field("Your review (optional)");comment.minLines=3;content.addView(rating);content.addView(comment)
                content.addView(action("Submit review").apply{setOnClickListener{runApi({CarewellApi.post("/doctors/${doctor.optString("id")}/reviews",JSONObject().put("rating",rating.text.toString().toIntOrNull()?:0).put("comment",comment.text.toString()))}){loadDoctorReviews(doctor)}}})
            } else if(viewer.optJSONObject("myReview")!=null)content.addView(note("You have already reviewed this doctor."))
            else if(user.optString("role")!="patient")content.addView(note("Sign in as a patient with a completed visit to leave a review."))
        }
    }

    private fun showBookingDate(doctor: JSONObject, clinic: JSONObject) {
        if (user.optString("role") != "patient") {
            showLogin(message = if (user.optString("role").isBlank()) "Sign in or create a patient account to request a visit." else "Only patient accounts can request appointments.")
            return
        }
        if (!user.optBoolean("emailVerified", false)) {
            showVerification("Verify your email before requesting an appointment.")
            return
        }
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
                val slots = result.getOrThrow() as JSONArray
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
        val filters = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("all" to "All", "upcoming" to "Upcoming", "completed" to "Completed", "cancelled" to "Cancelled", "rejected" to "Rejected").forEach { (key,title) ->
            filters.addView(action(title).apply { setOnClickListener { appointmentFilter=key; showHome("appointments") } })
        }
        content.addView(HorizontalScrollView(this).apply { addView(filters) })
        content.addView(action(if(appointmentCalendar)"Switch to list" else "Switch to calendar").apply { setOnClickListener { appointmentCalendar=!appointmentCalendar; showHome("appointments") } })
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(results)
        runApi({ CarewellApi.get("/appointments") as JSONArray }) { result ->
            if (result.isFailure) {
                results.addView(note(result.exceptionOrNull()?.message ?: "Could not load appointments."))
                return@runApi
            }
            val visits = result.getOrThrow() as JSONArray
            val all = (0 until visits.length()).map { visits.getJSONObject(it) }.sortedBy { it.optString("date") + it.optString("time") }
            val visible = all.filter { visit -> when(appointmentFilter) {
                "upcoming" -> visit.optString("status") in listOf("pending","accepted")
                "completed","cancelled","rejected" -> visit.optString("status")==appointmentFilter
                else -> true
            } }
            if (visible.isEmpty()) results.addView(note(if(all.isEmpty())"No appointment requests yet. Find a doctor to get started." else "No visits match this filter."))
            var lastDate = ""
            for (visit in visible) {
                if (appointmentCalendar && lastDate != visit.optString("date")) {
                    lastDate = visit.optString("date")
                    results.addView(label(lastDate,18,teal,true))
                }
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
                    card.addView(cancel.apply {
                        setOnClickListener {
                            confirmAction("Cancel this request?","The doctor will be notified.") {
                                cancel.isEnabled = false
                                runApi({ CarewellApi.patch("/appointment-requests/${visit.optString("id")}", JSONObject().put("status", "cancelled")) }) {
                                    if (it.isSuccess) showHome("appointments") else cancel.isEnabled = true
                                }
                            }
                        }
                    })
                }
                results.addView(card)
            }
        }
    }

    private fun showAccount() {
        content.removeAllViews()
        content.addView(label("Your account", 22, ink, true))
        if(user.optString("role")=="patient") loadPatientDashboard()
        if(user.optString("photoUrl").isNotBlank()) content.addView(remoteImage(user.optString("photoUrl"),dp(120)))
        content.addView(action("Update profile photo").apply{setOnClickListener{chooseImage("/me/photo")}})
        content.addView(action("Remove profile photo").apply{setOnClickListener{runApi({CarewellApi.delete("/me/photo") as JSONObject}){if(it.isSuccess){user=(it.getOrThrow() as JSONObject).optJSONObject("user")?:user;showHome("account")}else content.addView(note(it.exceptionOrNull()?.message?:"Could not remove photo."))}}})
        val name=field("Full name");name.setText(user.optString("name"));val phone=field("Phone number",android.text.InputType.TYPE_CLASS_PHONE);phone.setText(user.optString("phone"));content.addView(name);content.addView(phone)
        content.addView(action("Save profile details").apply{setOnClickListener{runApi({CarewellApi.patch("/auth/me",JSONObject().put("name",name.text.toString().trim()).put("phone",phone.text.toString().trim())) as JSONObject}){if(it.isSuccess){user=(it.getOrThrow() as JSONObject).optJSONObject("user")?:user;showHome("account")}else content.addView(note(it.exceptionOrNull()?.message?:"Could not update profile."))}}})
        content.addView(label(user.optString("email"), 15, muted))
        content.addView(label("${user.optString("role").replaceFirstChar{it.uppercase()}} account · ${if (user.optBoolean("emailVerified", false)) "email verified" else "email verification may be required"}", 14, muted))
        if (!user.optBoolean("emailVerified", false))
            content.addView(action("Verify email").apply { setOnClickListener { showVerification() } })
        val oldPassword=field("Current password",android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);val newPassword=field("New password",android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);content.addView(oldPassword);content.addView(newPassword)
        content.addView(action("Change password").apply {
            setOnClickListener {
                runApi({
                    CarewellApi.post(
                        "/auth/change-password",
                        JSONObject()
                            .put("currentPassword", oldPassword.text.toString())
                            .put("newPassword", newPassword.text.toString())
                    )
                }) { result ->
                    content.addView(
                        note(
                            if (result.isSuccess) "Password changed. Other sessions were signed out."
                            else result.exceptionOrNull()?.message ?: "Could not change password."
                        )
                    )
                }
            }
        })
        val logout = action("Sign out")
        content.addView(logout)
        logout.setOnClickListener {
            stopEvents()
            runApi({ CarewellApi.post("/auth/logout", JSONObject()) }) {
                user = JSONObject()
                showHome("discover")
            }
        }
    }

    private fun loadPatientDashboard() {
        val summary=card()
        content.addView(summary,1)
        summary.addView(label("Welcome back, ${user.optString("name", "there").substringBefore(' ')}",20,ink,true))
        runApi({
            val visits=CarewellApi.get("/appointments") as JSONArray
            val conversations=CarewellApi.get("/conversations") as JSONArray
            Pair(visits,conversations)
        }) { result ->
            if(result.isFailure){summary.addView(note(result.exceptionOrNull()?.message?:"Your care summary is unavailable."));return@runApi}
            @Suppress("UNCHECKED_CAST")
            val responsePair = result.getOrThrow() as Pair<JSONArray,JSONArray>
            val visits = responsePair.first
            val conversations = responsePair.second
            val items=(0 until visits.length()).map{visits.getJSONObject(it)}
            val upcoming=items.filter{it.optString("date")>=today()&&it.optString("status")=="accepted"}.sortedBy{it.optString("date")+it.optString("time")}.firstOrNull()
            val pending=items.filter{it.optString("date")>=today()&&it.optString("status")=="pending"}.size
            val completed=items.count{it.optString("status")=="completed"}
            summary.addView(label("${items.count{it.optString("date")>=today()&&it.optString("status") in listOf("accepted","pending")}} upcoming · $pending awaiting confirmation · $completed completed",14,muted))
            if(upcoming!=null)summary.addView(label("Next visit: ${upcoming.optString("date")} · ${upcoming.optString("time")} · ${upcoming.optJSONObject("doctor")?.optString("name")?:"Doctor"}",15,teal,true))
            else summary.addView(note(if(items.isEmpty())"Start with a doctor you trust." else "You have no upcoming confirmed visits."))
            summary.addView(action("Find a doctor").apply{setOnClickListener{showHome("doctors")}})
            summary.addView(action("View appointments").apply{setOnClickListener{showHome("appointments")}})
            summary.addView(action("Open messages (${conversations.length()})").apply{setOnClickListener{showHome("messages")}})
            for(i in 0 until minOf(conversations.length(),3)) {
                val conversation=conversations.getJSONObject(i)
                summary.addView(label("${conversation.optString("participantName")}: ${conversation.optJSONObject("lastMessage")?.optString("body")?:conversation.optString("lastMessage")}",13,muted))
            }
        }
    }

    private fun showScrollable(view:View) {
        setContentView(ScrollView(this).apply { isFillViewport=true; addView(view) })
    }

    private fun basePage() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.TOP
        setPadding(dp(24), dp(24), dp(24), dp(24))
        setBackgroundColor(if(darkTheme)Color.rgb(18,31,33) else Color.rgb(245,249,248))
    }

    private fun field(hintText: String, inputType: Int = android.text.InputType.TYPE_CLASS_TEXT) = EditText(this).apply {
        hint = translate(hintText)
        this.inputType = inputType
        setTextColor(ink)
        setHintTextColor(muted)
        textSize = 16f
        setSingleLine(inputType != android.text.InputType.TYPE_CLASS_TEXT)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        background = getDrawable(android.R.drawable.edit_text)
        val lp = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) }
        layoutParams = lp
    }

    private fun action(title: String) = Button(this).apply {
        text = translate(title)
        isAllCaps = false
        setTextColor(Color.WHITE)
        setBackgroundColor(teal)
        textSize = 15f
        val lp = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6); bottomMargin = dp(8) }
        layoutParams = lp
    }

    private fun label(text: String, size: Int, color: Int, bold: Boolean = false) = TextView(this).apply {
        this.text = translate(text)
        textSize = size.toFloat()
        setTextColor(color)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, dp(4), 0, dp(4))
    }

    private fun note(text: String) = TextView(this).apply {
        this.text = translate(text)
        textSize = 14f
        setTextColor(ink)
        setPadding(dp(14), dp(14), dp(14), dp(14))
        setBackgroundColor(if(darkTheme)Color.rgb(35,57,58) else Color.rgb(232,243,241))
    }

    private fun card() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(14), dp(12), dp(14), dp(12))
        setBackgroundColor(if(darkTheme)Color.rgb(28,43,45) else Color.WHITE)
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

    private fun remoteImage(source:String,size:Int=dp(96)):ImageView {
        val image=ImageView(this).apply {
            layoutParams=LinearLayout.LayoutParams(size,size).apply { bottomMargin=dp(8) }
            scaleType=ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(if(darkTheme)Color.rgb(35,57,58) else Color.rgb(232,243,241))
        }
        val address=if(source.startsWith("/"))"https://carewell-psi.vercel.app$source" else source
        imageWorker.execute {
            val bitmap=runCatching { URL(address).openConnection().apply { connectTimeout=8_000;readTimeout=8_000 }.getInputStream().use { BitmapFactory.decodeStream(it) } }.getOrNull()
            if(bitmap!=null&&!isFinishing)runOnUiThread{image.setImageBitmap(bitmap)}
        }
        return image
    }
    private fun translate(value: String): String {
        if (language != "bn") return value
        val exact = bengali.optString(value, "")
        if (exact.isNotEmpty()) return exact
        return value.replace(Regex("\\d")) { match -> "০১২৩৪৫৬৭৮৯"[match.value.toInt()].toString() }
    }

    private fun applySystemTheme() {
        window.statusBarColor = teal
        window.navigationBarColor = teal
        window.decorView.systemUiVisibility = if(darkTheme) 0 else View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
    }

    private fun confirmAction(title:String,message:String,onConfirm:()->Unit) {
        AlertDialog.Builder(this)
            .setTitle(translate(title))
            .setMessage(translate(message))
            .setNegativeButton(translate("Cancel"),null)
            .setPositiveButton(translate("Continue")) { _,_ -> onConfirm() }
            .show()
    }

    private val teal: Int get() = if(darkTheme)Color.rgb(87,195,181) else Color.rgb(10,96,91)
    private val muted: Int get() = if(darkTheme)Color.rgb(176,195,195) else Color.rgb(90,107,108)
    private val ink: Int get() = if(darkTheme)Color.rgb(232,243,241) else Color.rgb(27,43,45)
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        stopEvents()
        eventsWorker.shutdownNow()
        imageWorker.shutdownNow()
        worker.shutdownNow()
        super.onDestroy()
    }

}
