package app.bopomofo.auto.net

import org.json.JSONArray
import org.json.JSONObject

/** A string field, or null when it is missing or JSON null (optString would return "null"). */
fun JSONObject.str(key: String): String? = if (isNull(key)) null else optString(key)

fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }

fun jsonOf(vararg pairs: Pair<String, Any?>): JSONObject {
    val o = JSONObject()
    for ((k, v) in pairs) if (v != null) o.put(k, v)
    return o
}
