package ca.lumen.brightspace

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

/**
 * Runs the REAL BrightspaceApi (the same compiled code the app uses) against the mock
 * Brightspace:   node demo/mock-server.mjs   (LUMEN_MOCK_HOST overrides the address).
 * Skipped automatically when the mock isn't running.
 */
class BrightspaceApiTest {
    private val host = System.getenv("LUMEN_MOCK_HOST") ?: "http://127.0.0.1:8091"

    @Before fun requireMock() {
        val up = try {
            (URL("$host/d2l/api/versions/").openConnection() as HttpURLConnection).apply { connectTimeout = 1500; readTimeout = 1500 }.responseCode > 0
        } catch (e: Exception) { false }
        assumeTrue("Start the mock first: node demo/mock-server.mjs", up)
    }

    private fun api(cookie: String? = "d2lSessionVal=ok") = BrightspaceApi(host) { cookie }

    @Test fun signedOutIsDetected() = runBlocking {
        val e = runCatching { api(cookie = null).whoami() }.exceptionOrNull()
        assertTrue("expected ApiException, got $e", e is ApiException)
        assertTrue((e as ApiException).isSignedOut)
    }

    @Test fun whoami() = runBlocking {
        val me = api().whoami()
        assertEquals("Alex", me.firstName); assertEquals("Rivera", me.lastName)
    }

    @Test fun coursesParsedWithTermsAndCurrentFlag() = runBlocking {
        val cs = api().courses()
        assertEquals(8, cs.size)
        val comp = cs.first { it.code == "COMP 2402" }
        assertEquals("Abstract Data Types and Algorithms", comp.name)
        assertTrue("pinned flag", comp.pinned)
        assertFalse("ImageUrl is JSON null", comp.hasImage)
        assertEquals("6 current, 2 past", 6, cs.count { it.isCurrent })
        assertTrue(comp.termLabel.matches(Regex("(Fall|Summer|Winter) \\d{4}")))
        assertEquals(1, cs.filter { it.isCurrent }.map { it.termLabel }.distinct().size)
        assertNotEquals("hue is stable per code", cs[1].hue, Double.NaN)
    }

    @Test fun workItemsClassifiedWithCompletionAndStatus() = runBlocking {
        val a = api()
        val ids = a.courses().filter { it.isCurrent }.map { it.id }
        val work = a.workItems(ids)
        assertEquals(16, work.size)
        assertEquals(WorkKind.QUIZ, work.first { it.title.startsWith("Quiz 4") }.kind)
        assertEquals(WorkKind.ASSIGNMENT, work.first { it.title.startsWith("Assignment 3") }.kind)
        assertEquals(WorkKind.DISCUSSION, work.first { it.title.startsWith("Discussion: Sleep") }.kind)
        assertEquals("completed items from DateCompleted", 3, work.count { it.completed })
        val missing = work.filter { it.status(null) == WorkStatus.MISSING }.map { it.title }.toSet()
        assertEquals(setOf("WeBWorK Set 5: Matrix inverses", "Discussion: Sleep and learning"), missing)
        assertTrue("items link into Brightspace", work.first { it.title.startsWith("Quiz 4") }.url!!.startsWith(host))
        assertTrue("a done override beats the date", work.first { it.title.startsWith("WeBWorK Set 5") }.status(true) == WorkStatus.DONE)
    }

    @Test fun announcementsNewestFirstWithAttachments() = runBlocking {
        val news = api().news(101)
        assertEquals(3, news.size)
        assertEquals("Assignment 3 is posted", news[0].title)
        assertEquals(1, news[0].attachments.size)
        assertEquals("a3-starter.zip", news[0].attachments[0].name)
        assertTrue(news[0].attachments[0].url.startsWith("$host/d2l/le/news/101/"))
        assertTrue(news.zipWithNext().all { (x, y) -> x.date!! >= y.date!! })
        val text = Format.plainHtml(news[0].html)
        assertTrue(text, text.contains("skip lists and hashing") && text.contains("• Due: Friday 11:59 pm"))
        assertFalse(text.contains("<"))
    }

    @Test fun contentTreeKindsUnreadAndLocks() = runBlocking {
        val mods = api().toc(101)
        assertEquals(5, mods.size)
        val week9 = mods.first { it.title.startsWith("Week 9") }
        assertEquals(1, week9.submodules.size)
        assertEquals("unread rolls up from submodules", 3, week9.unreadCount)
        assertEquals(5, week9.totalCount)
        val all = mods.flatMap { m -> m.topics + m.submodules.flatMap { it.topics } }
        fun kindOf(t: String) = all.first { it.title.startsWith(t) }.kind
        assertEquals(WorkKind.PDF, kindOf("Course outline"))
        assertEquals(WorkKind.SHEET, kindOf("Weekly schedule"))
        assertEquals(WorkKind.SLIDES, kindOf("Lecture 17 slides"))
        assertEquals(WorkKind.VIDEO, kindOf("Lecture 17 recording"))
        assertEquals(WorkKind.LINK, kindOf("Heap visualizer"))
        assertEquals(WorkKind.QUIZ, kindOf("Quiz 4"))
        assertEquals(WorkKind.ASSIGNMENT, kindOf("Assignment 3"))
        assertTrue(all.first { it.title == "Midterm solutions" }.locked)
        assertTrue(all.first { it.title.startsWith("Lecture 17 slides") }.url.startsWith("$host/d2l/le/content/101/viewContent/"))
    }

    @Test fun gradesWeightedCurrentAndEmptyCourse() = runBlocking {
        val g = api().grades(101)
        assertEquals(6, g.items.size)
        assertNull("no final grade released", g.finalDisplay)
        val (value, weighted) = g.current!!
        assertTrue("weighted, since every item carries a weight", weighted)
        // earned 42.886 of 52.5 released weight
        assertEquals(81.69, value, 0.05)
        assertEquals(92.5, g.items.first { it.name == "Assignment 1" }.percent!!, 0.001)
        val none = api().grades(104)
        assertTrue(none.items.isEmpty()); assertNull(none.current)
    }
}
