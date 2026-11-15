package ca.lumen.brightspace

import android.app.Application
import android.webkit.CookieManager
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.fail
import org.robolectric.shadows.ShadowLooper
import androidx.test.core.app.ApplicationProvider
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Renders the real Compose screens (headless, Robolectric native graphics) against the mock
 * Brightspace (node demo/mock-server.mjs) and saves screenshots to app/build/screenshots/.
 * A crash anywhere in composition (bad constraints, nested scrolling, ...) fails the test.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi")
class ScreensRenderTest {
    @get:Rule val rule = createComposeRule()
    private val host = System.getenv("LUMEN_MOCK_HOST") ?: "http://127.0.0.1:8091"
    private val out = File("build/screenshots").apply { mkdirs() }

    @Before fun requireMock() {
        val up = try { (URL("$host/d2l/api/versions/").openConnection() as HttpURLConnection).apply { connectTimeout = 1500; readTimeout = 1500 }.responseCode > 0 } catch (e: Exception) { false }
        assumeTrue("Start the mock first: node demo/mock-server.mjs", up)
    }

    init { System.setProperty("roborazzi.test.record", "true") }   // write the PNGs (no baseline compare)

    private fun shot(name: String) {
        pump()
        rule.onRoot().captureRoboImage(File(out, "$name.png").path)
    }

    /** Robolectric's main looper is paused: run pending work (coroutine resumptions, frames). */
    private fun pump() { ShadowLooper.idleMainLooper(); rule.waitForIdle() }

    /** Wait for async work (network → state) by pumping the looper ourselves. */
    private fun await(timeoutMs: Long = 30_000, what: String = "condition", cond: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (true) {
            pump()
            if (cond()) return
            if (System.currentTimeMillis() > end) fail("Timed out after ${timeoutMs}ms waiting for $what")
            Thread.sleep(25)
        }
    }
    private fun hasText(t: String) = rule.onAllNodesWithText(t).fetchSemanticsNodes().isNotEmpty()

    private fun connectedVm(): AppViewModel {
        CookieManager.getInstance().setCookie(host, "d2lSessionVal=ok")
        val vm = AppViewModel(ApplicationProvider.getApplicationContext<Application>())
        vm.connect(host, "Mock University")
        await(what = "courses + work to load") { vm.courses.isNotEmpty() && vm.work.isNotEmpty() }
        return vm
    }

    @Test fun connectScreen() {
        val vm = AppViewModel(ApplicationProvider.getApplicationContext<Application>())
        rule.setContent { LumenTheme("light") { ConnectScreen(vm) } }
        rule.onNodeWithText("Brightspace, organized.").assertExists()
        rule.onNodeWithText("Carleton University").assertExists()
        rule.onNodeWithText("Sign in with Brightspace").assertIsEnabled()
        shot("01-connect")
    }

    @Test fun mainTabsRenderWithData() {
        val vm = connectedVm()
        rule.setContent { LumenTheme("light") { MainScaffold(vm) } }
        rule.onNodeWithText("Your classes").assertExists()
        val hues = vm.currentCourses().map { it.hue }
        org.junit.Assert.assertEquals("every current class has its own color", hues.size, hues.distinct().size)
        rule.onAllNodesWithText("Abstract Data Types and Algorithms")[0].assertExists()
        shot("02-classes")

        rule.onNodeWithText("To-do").performClick(); rule.waitForIdle()
        rule.onNodeWithText("Assigned").assertExists()
        rule.onAllNodesWithText("Quiz 4 – Priority queues")[0].assertExists()
        shot("03-todo")

        rule.onNodeWithText("Calendar").performClick(); rule.waitForIdle()
        rule.onNodeWithText("Today").assertExists()
        shot("04-calendar")

        rule.onNodeWithText("Grades").performClick(); rule.waitForIdle()
        shot("05-grades-overview")

        rule.onNodeWithText("Settings").performClick(); rule.waitForIdle()
        rule.onNodeWithText("Disconnect").assertExists()
        shot("06-settings")
    }

    @Test fun courseScreenAllTabs() {
        val vm = connectedVm()
        rule.setContent { LumenTheme("dark") { CourseScreen(vm, 101) {} } }
        await(what = "announcements") { hasText("Assignment 3 is posted") }
        shot("07-course-stream-dark")

        rule.onNodeWithText("Classwork").performClick()
        await(what = "course content") { hasText("Week 9 – Hashing") }
        rule.onNodeWithText("Week 9 – Hashing").performClick(); rule.waitForIdle()
        rule.onAllNodesWithText("Assignment 3: Skip lists and hashing")[0].assertExists()
        shot("08-course-classwork-dark")

        rule.onNodeWithText("Work").performClick(); rule.waitForIdle()
        rule.onNodeWithText("Upcoming").assertExists()
        shot("09-course-work-dark")

        rule.onNodeWithText("Grades").performClick()
        await(what = "grades") { hasText("Midterm") }
        shot("10-course-grades-dark")
    }
}
