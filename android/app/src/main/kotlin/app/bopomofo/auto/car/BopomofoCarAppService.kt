package app.bopomofo.auto.car

import android.content.Intent
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.SessionInfo
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.validation.HostValidator
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import app.bopomofo.auto.BopomofoApp

/** The Android Auto entry point. The app is sideloaded, so any Android Auto host may connect. */
class BopomofoCarAppService : CarAppService() {
    override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

    override fun onCreateSession(sessionInfo: SessionInfo): Session = BopomofoSession()
}

class BopomofoSession : Session() {
    override fun onCreateScreen(intent: Intent): Screen = HomeScreen(carContext)
}

internal fun row(title: String, text: String, onClick: () -> Unit): Row =
    Row.Builder().setTitle(title).addText(text).setBrowsable(true).setOnClickListener(onClick).build()

/** Sign-in check, then the two kinds of practice: speak (hands-free) and choose (tap an answer). */
class HomeScreen(ctx: CarContext) : Screen(ctx) {
    private val app = BopomofoApp.of(ctx)

    init {
        // Sign-in happens on the phone: look again each time the screen shows.
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = invalidate()
        })
    }

    override fun onGetTemplate(): Template {
        if (!app.auth.signedIn) {
            return MessageTemplate.Builder("Open Bopomofo on your phone and sign in. Then tap Retry.")
                .setTitle("Bopomofo")
                .setHeaderAction(Action.APP_ICON)
                .addAction(Action.Builder().setTitle("Retry").setOnClickListener { invalidate() }.build())
                .build()
        }
        val list = ItemList.Builder()
            .addItem(row("Speak", "Hands-free: symbols, syllables, sentences, numbers") { screenManager.push(MenuScreen(carContext, speak = true)) })
            .addItem(row("Choose", "Tap the answer: tones, Bopomofo, characters, numbers") { screenManager.push(MenuScreen(carContext, speak = false)) })
            .build()
        val name = app.auth.name
        return ListTemplate.Builder()
            .setTitle(if (name.isNotEmpty()) "Bopomofo · $name" else "Bopomofo")
            .setHeaderAction(Action.APP_ICON)
            .setSingleList(list)
            .build()
    }
}

class MenuScreen(ctx: CarContext, private val speak: Boolean) : Screen(ctx) {
    override fun onGetTemplate(): Template {
        val b = ItemList.Builder()
        if (speak) {
            for (k in SpeakKind.entries) b.addItem(row(k.title, k.about) { screenManager.push(SpeakScreen(carContext, k)) })
        } else {
            for (k in ChoiceKind.entries) b.addItem(row(k.menu, k.about) { screenManager.push(ChoiceScreen(carContext, k)) })
        }
        return ListTemplate.Builder()
            .setTitle(if (speak) "Speak" else "Choose")
            .setHeaderAction(Action.BACK)
            .setSingleList(b.build())
            .build()
    }
}
