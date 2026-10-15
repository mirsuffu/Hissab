package org.sufiyan.hisaab.bridge

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.biometric.BiometricManager
import org.sufiyan.hisaab.MainActivity
import org.sufiyan.hisaab.service.HisaabNotificationService
import org.sufiyan.hisaab.widget.HisaabWidgetProvider

/**
 * High-performance native JavaScript bridge for Hisaab.
 * Exposes OS-level hardware features (Fingerprint Sensor, Haptics, Persistent Notification, App Widget).
 */
class AndroidBridge(
    private val activity: MainActivity,
    private val webView: WebView
) {
    private val context: Context get() = activity.applicationContext

    /**
     * Checks if native hardware biometric authentication is available on device.
     */
    @JavascriptInterface
    fun isBiometricAvailable(): Boolean {
        val biometricManager = BiometricManager.from(context)
        val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.BIOMETRIC_WEAK
        return biometricManager.canAuthenticate(authenticators) == BiometricManager.BIOMETRIC_SUCCESS
    }

    /**
     * Triggers the native Android OS BiometricPrompt dialog (Hardware fingerprint sensor, NOT Google Passkey).
     * Dispatches result back into web runtime via [callbackJsName].
     */
    @JavascriptInterface
    fun authenticateBiometric(reason: String, callbackJsName: String) {
        activity.runOnUiThread {
            activity.showBiometricPrompt(reason) { success ->
                val js = "if (typeof window['$callbackJsName'] === 'function') { window['$callbackJsName']($success); }"
                webView.post {
                    webView.evaluateJavascript(js, null)
                }
            }
        }
    }

    /**
     * Crisp, low-latency haptic feedback.
     * @param style 1: Light click (10ms), 2: Medium (25ms), 3: Heavy/Error (40ms)
     */
    @JavascriptInterface
    fun hapticFeedback(style: Int) {
        try {
            val durationMs = when (style) {
                1 -> 12L
                2 -> 25L
                3 -> 45L
                else -> 15L
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vibratorManager?.defaultVibrator?.vibrate(
                    VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE)
                )
            } else {
                @Suppress("DEPRECATION")
                val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator?.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator?.vibrate(durationMs)
                }
            }
        } catch (_: Exception) {
            // Ignore devices without vibrator hardware
        }
    }

    /**
     * Updates the persistent quick-entry notification in the Android notification shade.
     */
    @JavascriptInterface
    fun updateNotification(todayExpense: String, totalBalance: String) {
        HisaabNotificationService.updateQuickGlance(context, todayExpense, totalBalance)
    }

    /**
     * Synchronizes live financial figures into the Android Home Screen Widget.
     */
    @JavascriptInterface
    fun updateWidget(widgetDataJson: String) {
        HisaabWidgetProvider.updateFromData(context, widgetDataJson)
    }

    /**
     * Native Android Toast message.
     */
    @JavascriptInterface
    fun showToast(message: String) {
        activity.runOnUiThread {
            Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * Marker method to inform Web UI that it is running inside the native Kotlin Android shell.
     */
    @JavascriptInterface
    fun isNativeApp(): Boolean = true
}
