"""FocusFlow Flask application backed by Supabase Auth and Postgres."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import secrets
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import certifi
from cryptography.fernet import Fernet, InvalidToken
from flask import (
    Flask,
    abort,
    flash,
    g,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # Environment variables supplied by the host are sufficient in production.
    pass


FOCUSFLOW_BASE_URL = os.environ.get("FOCUSFLOW_BASE_URL", "http://127.0.0.1:5000").strip().rstrip("/")
https_deployment = FOCUSFLOW_BASE_URL.lower().startswith("https://")
production_deployment = os.environ.get("FLASK_ENV", "").lower() == "production"

app = Flask(__name__)
configured_secret = os.environ.get("FOCUSFLOW_SECRET_KEY")
if not configured_secret and (https_deployment or production_deployment):
    raise RuntimeError("FOCUSFLOW_SECRET_KEY must be set to a stable value for production sessions")
app.secret_key = configured_secret or secrets.token_hex(32)
if not configured_secret:
    app.logger.warning(
        "FOCUSFLOW_SECRET_KEY is unset; local development sessions will be invalidated on restart"
    )
app.permanent_session_lifetime = timedelta(days=90)
cookie_secure_override = os.environ.get("FOCUSFLOW_COOKIE_SECURE", "").lower() in {"1", "true", "yes"}
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=cookie_secure_override or https_deployment or production_deployment,
    MAX_CONTENT_LENGTH=1024 * 1024,
)
app.logger.setLevel(logging.INFO)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_PUBLISHABLE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
if not SUPABASE_URL or not SUPABASE_PUBLISHABLE_KEY:
    app.logger.warning("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured")
if not SUPABASE_SERVICE_ROLE_KEY:
    app.logger.warning("SUPABASE_SERVICE_ROLE_KEY is not configured; duplicate signup detection is limited to Supabase signup error handling")

_fernet_key = base64.urlsafe_b64encode(
    hashlib.sha256(app.secret_key.encode("utf-8")).digest()
)
_token_cipher = Fernet(_fernet_key)
_https_context = ssl.create_default_context(cafile=certifi.where())
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_ALLOWED_DATA_KEYS = {
    "focusflow_goals",
    "focusflow_user_state",
    "focusflow_monthly_goal",
    "focusflow_reflection",
    "focusflow_selected_goal",
    "focusflow_reminder_schedule",
}
_NOTIFICATION_CATEGORIES = {
    "morning",
    "night",
    "incomplete_goals",
    "streak",
    "completion",
    "comeback",
}


class SupabaseError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _supabase_request(path: str, *, method="GET", body=None, access_token=None,
                      extra_headers=None):
    if not SUPABASE_URL or not SUPABASE_PUBLISHABLE_KEY:
        raise SupabaseError("Supabase is not configured on this server.", 503)
    headers = {
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    if extra_headers:
        headers.update(extra_headers)
    payload = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}{path}", data=payload, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=12, context=_https_context) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            detail = {}
        message = detail.get("msg") or detail.get("message") or detail.get("error_description") or "Supabase request failed."
        raise SupabaseError(str(message), error.code) from error
    except (urllib.error.URLError, TimeoutError) as error:
        app.logger.warning("Supabase request failed: %s", error)
        raise SupabaseError("Supabase could not be reached. Please try again.", 503) from error
    except (ValueError, UnicodeDecodeError) as error:
        raise SupabaseError("Supabase returned an invalid response.", 502) from error


def _auth_request(path: str, *, body=None, method="POST", access_token=None):
    return _supabase_request(
        f"/auth/v1/{path}", method=method, body=body, access_token=access_token
    )


def _supabase_admin_request(path: str, *, method="GET", body=None, extra_headers=None):
    if not SUPABASE_URL:
        raise SupabaseError("Supabase is not configured on this server.", 503)
    service_key = SUPABASE_SERVICE_ROLE_KEY
    if not service_key:
        raise SupabaseError("Supabase service-role key is not configured on this server.", 503)
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    payload = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}{path}", data=payload, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=12, context=_https_context) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            detail = {}
        message = detail.get("msg") or detail.get("message") or detail.get("error_description") or "Supabase admin request failed."
        raise SupabaseError(str(message), error.code) from error
    except (urllib.error.URLError, TimeoutError) as error:
        app.logger.warning("Supabase admin request failed: %s", error)
        raise SupabaseError("Supabase could not be reached. Please try again.", 503) from error
    except (ValueError, UnicodeDecodeError) as error:
        raise SupabaseError("Supabase returned an invalid response.", 502) from error


def _fetch_existing_user_by_email(email):
    if not email or not SUPABASE_SERVICE_ROLE_KEY:
        return None
    normalized_email = email.strip().lower()
    page = 1
    per_page = 100
    try:
        while True:
            response = _supabase_admin_request(
                "/auth/v1/admin/users?" + urllib.parse.urlencode(
                    {"page": page, "per_page": per_page}
                )
            )
            if not isinstance(response, dict):
                return None
            users = response.get("users") or []
            for user in users:
                user_email = (user.get("email") or "").strip().lower()
                if user_email == normalized_email:
                    return user
            total = response.get("total")
            if not isinstance(total, int) or total <= page * per_page:
                return None
            page += 1
    except SupabaseError:
        return None


def _auth_redirect_url(endpoint: str):
    return f"{FOCUSFLOW_BASE_URL}{url_for(endpoint)}"


def _store_auth_session(auth_session, remember_me=True):
    # Flask's signed cookie is readable by its holder. Encrypt Supabase tokens
    # before placing them in it; the publishable key is never treated as secret.
    encrypted = _token_cipher.encrypt(
        json.dumps(auth_session, separators=(",", ":")).encode("utf-8")
    )
    session.clear()
    session["supabase_session"] = encrypted.decode("ascii")
    session.permanent = bool(remember_me)


def _read_auth_session():
    value = session.get("supabase_session")
    if not value:
        return None
    try:
        return json.loads(_token_cipher.decrypt(value.encode("ascii")))
    except (InvalidToken, ValueError, TypeError, UnicodeDecodeError):
        session.clear()
        return None


def _current_user():
    if hasattr(g, "focusflow_user"):
        return g.focusflow_user
    auth_session = _read_auth_session()
    if not auth_session:
        g.focusflow_user = None
        return None
    access_token = auth_session.get("access_token")
    if not access_token:
        session.clear()
        g.focusflow_user = None
        return None
    try:
        response = _auth_request("user", method="GET", access_token=access_token)
    except SupabaseError as error:
        if error.status != 401 or not auth_session.get("refresh_token"):
            if error.status in {400, 401, 403}:
                session.clear()
                g.focusflow_user = None
                return None
            raise
        refreshed = _auth_request(
            "token?grant_type=refresh_token",
            body={"refresh_token": auth_session["refresh_token"]},
        )
        _store_auth_session(refreshed, remember_me=session.permanent)
        response = _auth_request(
            "user", method="GET", access_token=refreshed["access_token"]
        )
    user = response.get("user", response) if isinstance(response, dict) else None
    if not user or not user.get("id"):
        session.clear()
        user = None
    else:
        metadata = user.get("user_metadata") or {}
        user = {
            "id": user["id"],
            "email": user.get("email", ""),
            "name": metadata.get("name") or metadata.get("full_name") or "",
        }
    g.focusflow_user = user
    return user


def _load_user_data(user):
    if not user:
        return {}
    auth_session = _read_auth_session() or {}
    try:
        rows = _supabase_request(
            "/rest/v1/focusflow_user_data?select=key,value",
            access_token=auth_session.get("access_token"),
        ) or []
    except SupabaseError:
        app.logger.exception("Could not load FocusFlow data for authenticated user")
        return {}
    return {row["key"]: row.get("value") for row in rows if row.get("key") in _ALLOWED_DATA_KEYS}


def is_valid_email(email):
    return bool(_EMAIL_RE.match(email))


@app.context_processor
def inject_user():
    user = _current_user()
    return {"current_user": user, "persisted_data": _load_user_data(user)}


@app.route("/")
def landing():
    if _current_user() is not None:
        return redirect(url_for("home"))
    return render_template(
        "landing.html",
        skip_intro=request.args.get("skip_intro") == "1",
        authenticated=False,
    )


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if _current_user() is not None:
        return redirect(url_for("home"))
    if request.method == "GET":
        return render_template("signup.html")
    name = request.form.get("name", "").strip()
    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")
    if not name or len(name) > 100:
        flash("Please enter a name of 1 to 100 characters.", "error")
        return redirect(url_for("signup"))
    if not is_valid_email(email):
        flash("Please enter a valid email address.", "error")
        return redirect(url_for("signup"))
    if len(password) < 6:
        flash("Password must contain at least 6 characters.", "error")
        return redirect(url_for("signup"))
    if _fetch_existing_user_by_email(email):
        flash("An account already exists with this email. Please log in instead. If you forgot your password, use Forgot Password.", "error")
        return redirect(url_for("signup"))
    try:
        result = _auth_request(
            "signup?" + urllib.parse.urlencode({"redirect_to": _auth_redirect_url("auth_verify")}),
            body={"email": email, "password": password, "data": {"name": name}},
        )
        if result and result.get("access_token"):
            _store_auth_session(result)
            return redirect(url_for("home"))
        flash("Check your email to confirm your account, then log in.", "success")
        return redirect(url_for("login"))
    except SupabaseError as error:
        message = str(error)
        lower_message = message.lower()
        if "already" in lower_message or "registered" in lower_message or "exists" in lower_message:
            flash("An account already exists with this email. Please log in instead. If you forgot your password, use Forgot Password.", "error")
        else:
            flash(message, "error")
        return redirect(url_for("signup"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if _current_user() is not None:
        return redirect(url_for("home"))
    if request.method == "GET":
        return render_template("login.html")
    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")
    remember_me = request.form.get("remember_me") == "on"
    if not is_valid_email(email) or not password:
        flash("Please enter a valid email address and password.", "error")
        return redirect(url_for("login"))
    try:
        result = _auth_request(
            "token?grant_type=password", body={"email": email, "password": password}
        )
        if not result or not result.get("access_token"):
            raise SupabaseError("Login could not be completed.", 401)
        _store_auth_session(result, remember_me=remember_me)
        return redirect(url_for("home"))
    except SupabaseError as error:
        flash("Incorrect email or password." if error.status in {400, 401} else str(error), "error")
        return redirect(url_for("login"))


@app.route("/forgot-password", methods=["GET", "POST"])
def forgot_password():
    if _current_user() is not None:
        return redirect(url_for("home"))
    if request.method == "GET":
        return render_template("forgot_password.html")
    email = request.form.get("email", "").strip().lower()
    if not is_valid_email(email):
        flash("Please enter a valid email address.", "error")
        return redirect(url_for("forgot_password"))
    redirect_to = _auth_redirect_url("auth_recover")
    try:
        _auth_request(
            "recover?" + urllib.parse.urlencode({"redirect_to": redirect_to}),
            body={"email": email},
        )
    except SupabaseError as error:
        app.logger.error(
            "Supabase password recovery request failed: status=%s message=%s",
            error.status,
            str(error),
        )
    flash("If an account exists for that email, a password-reset link has been sent.", "success")
    return redirect(url_for("forgot_password"))


@app.route("/auth/verify")
def auth_verify():
    token_hash = request.args.get("token_hash", "").strip()
    auth_type = (request.args.get("type", "") or "").strip()
    if not token_hash or auth_type not in {"email", "signup"}:
        flash("This verification link is invalid or has expired. Please sign up again or request a new verification email.", "error")
        return redirect(url_for("login"))
    try:
        result = _auth_request("verify", method="POST", body={"token_hash": token_hash, "type": auth_type})
    except SupabaseError:
        flash("This verification link is invalid or has expired. Please sign up again or request a new verification email.", "error")
        return redirect(url_for("login"))
    if result and result.get("access_token"):
        _store_auth_session(result)
        return redirect(url_for("home"))
    flash("This verification link is invalid or has expired. Please sign up again or request a new verification email.", "error")
    return redirect(url_for("login"))


@app.route("/auth/recover")
def auth_recover():
    token_hash = request.args.get("token_hash", "").strip()
    auth_type = (request.args.get("type", "") or "").strip()
    if not token_hash or auth_type != "recovery":
        flash("This password reset link is invalid or has expired.", "error")
        return redirect(url_for("forgot_password"))
    try:
        result = _auth_request("verify", method="POST", body={"token_hash": token_hash, "type": auth_type})
    except SupabaseError:
        flash("This password reset link is invalid or has expired.", "error")
        return redirect(url_for("forgot_password"))
    if result and result.get("access_token"):
        _store_auth_session(result)
        return redirect(url_for("reset_password"))
    flash("This password reset link is invalid or has expired.", "error")
    return redirect(url_for("forgot_password"))


@app.route("/auth/session", methods=["POST"])
def establish_recovery_session():
    payload = request.get_json(silent=True) or {}
    access_token = str(payload.get("access_token", ""))
    refresh_token = str(payload.get("refresh_token", ""))
    if not access_token or len(access_token) > 10000:
        abort(400)
    try:
        user = _auth_request("user", method="GET", access_token=access_token)
    except SupabaseError:
        abort(401)
    user = user.get("user", user) if isinstance(user, dict) else None
    if not user or not user.get("id"):
        abort(401)
    _store_auth_session({"access_token": access_token, "refresh_token": refresh_token})
    return jsonify({"ok": True})


@app.route("/reset-password", methods=["GET", "POST"])
@app.route("/reset-password/<path:unused_token>", methods=["GET", "POST"])
def reset_password(unused_token=None):
    user = _current_user()
    if request.method == "GET":
        return render_template("reset_password.html", valid_token=bool(user))
    if not user:
        flash("Open the password reset link from your email first.", "error")
        return redirect(url_for("forgot_password"))
    password = request.form.get("password", "")
    confirm = request.form.get("confirm_password", "")
    if len(password) < 6:
        flash("Password must contain at least 6 characters.", "error")
        return redirect(url_for("reset_password"))
    if password != confirm:
        flash("Passwords do not match.", "error")
        return redirect(url_for("reset_password"))
    auth_session = _read_auth_session() or {}
    try:
        _auth_request(
            "user", method="PUT", access_token=auth_session.get("access_token"),
            body={"password": password},
        )
        session.clear()
        flash("Your password has been reset successfully. You can now log in.", "success")
        return redirect(url_for("login"))
    except SupabaseError as error:
        flash(str(error), "error")
        return redirect(url_for("reset_password"))


@app.route("/logout", methods=["GET", "POST"])
def logout():
    user = _current_user()
    auth_session = _read_auth_session() or {}
    if user:
        user_query = _notification_user_query(user["id"])
        try:
            _supabase_admin_request(
                "/rest/v1/focusflow_notification_preferences?" + user_query,
                method="PATCH",
                body={"enabled": False},
            )
        except SupabaseError:
            app.logger.warning("Could not disable notification preferences during logout")
        try:
            _supabase_admin_request(
                "/rest/v1/focusflow_push_subscriptions?" + user_query,
                method="DELETE",
            )
        except SupabaseError:
            app.logger.warning("Could not remove push subscriptions during logout")
    if auth_session.get("access_token"):
        try:
            _auth_request("logout", access_token=auth_session["access_token"])
        except SupabaseError:
            app.logger.info("Supabase logout could not revoke the session")
    session.clear()
    return redirect(url_for("landing", skip_intro=1))


@app.route("/api/user-data", methods=["GET", "PUT"])
def user_data():
    user = _current_user()
    if not user:
        return jsonify({"error": "Authentication required."}), 401
    if request.method == "GET":
        return jsonify(_load_user_data(user))
    payload = request.get_json(silent=True) or {}
    key = payload.get("key")
    if key not in _ALLOWED_DATA_KEYS and not (
        isinstance(key, str) and key.startswith("focusflow_reminder_")
    ):
        return jsonify({"error": "Unsupported data key."}), 400
    auth_session = _read_auth_session() or {}
    try:
        _supabase_request(
            "/rest/v1/focusflow_user_data?on_conflict=user_id%2Ckey",
            method="POST",
            body={"user_id": user["id"], "key": key, "value": payload.get("value")},
            access_token=auth_session.get("access_token"),
            extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        return jsonify({"ok": True})
    except SupabaseError as error:
        app.logger.exception("Could not save FocusFlow user data")
        return jsonify({"error": str(error)}), error.status


def _notification_user_query(user_id):
    return urllib.parse.urlencode({"user_id": f"eq.{user_id}"})


def _notifications_csrf_is_valid():
    expected = session.get("settings_csrf_token", "")
    supplied = request.headers.get("X-CSRF-Token", "")
    return bool(expected and supplied and secrets.compare_digest(expected, supplied))


def _is_supported_push_endpoint(endpoint):
    try:
        parsed = urllib.parse.urlsplit(endpoint)
        host = (parsed.hostname or "").lower()
        return parsed.scheme == "https" and parsed.port in (None, 443) and (
            host in {
                "fcm.googleapis.com",
                "web.push.apple.com",
                "updates.push.services.mozilla.com",
            }
            or host.endswith(".notify.windows.com")
        )
    except ValueError:
        return False


@app.route("/api/notifications/config", methods=["GET"])
def notification_config():
    user = _current_user()
    if not user:
        return jsonify({"error": "Authentication required."}), 401
    user_query = _notification_user_query(user["id"])
    try:
        preferences = _supabase_admin_request(
            "/rest/v1/focusflow_notification_preferences?select=enabled,timezone,categories&"
            + user_query + "&limit=1"
        ) or []
        subscriptions = _supabase_admin_request(
            "/rest/v1/focusflow_push_subscriptions?select=endpoint_hash&"
            + user_query + "&limit=1"
        ) or []
        saved = preferences[0] if preferences else {}
        return jsonify({
            "publicKey": os.environ.get("NOTIFICATION_VAPID_PUBLIC_KEY", ""),
            "enabled": bool(saved.get("enabled", False)),
            "timezone": saved.get("timezone", "UTC"),
            "categories": saved.get("categories") or {name: True for name in _NOTIFICATION_CATEGORIES},
            "hasSubscription": bool(subscriptions),
        })
    except SupabaseError as error:
        return jsonify({"error": str(error)}), error.status


@app.route("/api/notifications/subscriptions", methods=["POST"])
def save_notification_subscription():
    user = _current_user()
    if not user:
        return jsonify({"error": "Authentication required."}), 401
    if not _notifications_csrf_is_valid():
        return jsonify({"error": "This page expired. Refresh and try again."}), 400

    payload = request.get_json(silent=True) or {}
    subscription = payload.get("subscription")
    endpoint = subscription.get("endpoint") if isinstance(subscription, dict) else None
    keys = subscription.get("keys") if isinstance(subscription, dict) else None
    if not isinstance(endpoint, str) or len(endpoint) > 2048:
        return jsonify({"error": "The push subscription is invalid."}), 400
    if not _is_supported_push_endpoint(endpoint):
        return jsonify({"error": "This browser push service is not supported."}), 400
    p256dh = keys.get("p256dh") if isinstance(keys, dict) else None
    auth_key = keys.get("auth") if isinstance(keys, dict) else None
    if (not isinstance(p256dh, str) or not isinstance(auth_key, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{20,200}", p256dh)
            or not re.fullmatch(r"[A-Za-z0-9_-]{8,100}", auth_key)):
        return jsonify({"error": "The push encryption keys are invalid."}), 400

    endpoint_hash = hashlib.sha256(endpoint.encode("utf-8")).hexdigest()
    try:
        registered = _supabase_admin_request(
            "/rest/v1/rpc/focusflow_register_push_subscription",
            method="POST",
            body={
                "p_endpoint_hash": endpoint_hash,
                "p_user_id": user["id"],
                "p_endpoint": endpoint,
                "p_p256dh": p256dh,
                "p_auth_key": auth_key,
            },
        )
        if registered is not True:
            return jsonify({"error": "This device subscription is registered to another account. Log out of that account first."}), 409
        return jsonify({"ok": True})
    except SupabaseError as error:
        return jsonify({"error": str(error)}), error.status


@app.route("/api/notifications/preferences", methods=["POST"])
def save_notification_preferences():
    user = _current_user()
    if not user:
        return jsonify({"error": "Authentication required."}), 401
    if not _notifications_csrf_is_valid():
        return jsonify({"error": "This page expired. Refresh and try again."}), 400

    payload = request.get_json(silent=True) or {}
    enabled = payload.get("enabled") is True
    timezone_name = payload.get("timezone")
    try:
        if not isinstance(timezone_name, str) or len(timezone_name) > 100:
            raise ZoneInfoNotFoundError(timezone_name)
        ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return jsonify({"error": "Choose a valid IANA timezone."}), 400

    raw_categories = payload.get("categories")
    raw_categories = raw_categories if isinstance(raw_categories, dict) else {}
    categories = {
        name: raw_categories.get(name) is True
        for name in _NOTIFICATION_CATEGORIES
    }
    user_query = _notification_user_query(user["id"])
    try:
        if enabled:
            subscriptions = _supabase_admin_request(
                "/rest/v1/focusflow_push_subscriptions?select=endpoint_hash&"
                + user_query + "&limit=1"
            ) or []
            if not subscriptions:
                return jsonify({"error": "Enable push notifications on this device first."}), 400
        _supabase_admin_request(
            "/rest/v1/focusflow_notification_preferences?on_conflict=user_id",
            method="POST",
            body={
                "user_id": user["id"],
                "enabled": enabled,
                "timezone": timezone_name,
                "categories": categories,
            },
            extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        return jsonify({"ok": True, "enabled": enabled, "categories": categories})
    except SupabaseError as error:
        return jsonify({"error": str(error)}), error.status


@app.route("/service-worker.js")
def service_worker():
    response = make_response(send_from_directory(
        app.static_folder, "service-worker.js", mimetype="application/javascript"
    ))
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache"
    return response


def _require_user():
    user = _current_user()
    if not user:
        return None, redirect(url_for("login"))
    return user, None


@app.route("/home")
def home():
    user, response = _require_user()
    return response or render_template("home.html", user=user)


@app.route("/goals")
def goals():
    user, response = _require_user()
    return response or render_template("goals.html", user=user)


@app.route("/focus")
def focus():
    user, response = _require_user()
    return response or render_template("focus.html", user=user)


@app.route("/track")
def track():
    user, response = _require_user()
    return response or render_template("track.html", user=user)


@app.route("/achievements")
def achievements():
    user, response = _require_user()
    return response or render_template("achievements.html", user=user)


@app.route("/settings")
def settings():
    user, response = _require_user()
    if response:
        return response
    csrf_token = session.setdefault("settings_csrf_token", secrets.token_urlsafe(32))
    return render_template("settings.html", user=user, csrf_token=csrf_token)


def _settings_form_is_valid():
    token = session.get("settings_csrf_token", "")
    submitted_token = request.form.get("csrf_token", "")
    return bool(token and secrets.compare_digest(token, submitted_token))


@app.route("/settings/password", methods=["POST"])
def update_account_password():
    user, response = _require_user()
    if response:
        return response
    if not _settings_form_is_valid():
        abort(400)
    password = request.form.get("password", "")
    confirm = request.form.get("confirm_password", "")
    if len(password) < 6:
        flash("Password must contain at least 6 characters.", "error")
        return redirect(url_for("settings"))
    if password != confirm:
        flash("Passwords do not match.", "error")
        return redirect(url_for("settings"))
    auth_session = _read_auth_session() or {}
    try:
        _auth_request(
            "user", method="PUT", access_token=auth_session.get("access_token"),
            body={"password": password},
        )
    except SupabaseError as error:
        app.logger.error(
            "Could not update account password: status=%s message=%s",
            error.status,
            str(error),
        )
        flash("Your password could not be updated. Please try again.", "error")
        return redirect(url_for("settings"))
    flash("Your password has been updated.", "success")
    return redirect(url_for("settings"))


@app.route("/settings/delete-account", methods=["POST"])
def delete_account():
    user, response = _require_user()
    if response:
        return response
    if not _settings_form_is_valid():
        abort(400)
    if request.form.get("confirmation", "").strip() != "DELETE":
        flash("Type DELETE to confirm permanent account deletion.", "error")
        return redirect(url_for("settings"))

    user_id = user["id"]
    try:
        user_query = _notification_user_query(user_id)
        _supabase_admin_request(
            "/rest/v1/focusflow_notification_preferences?" + user_query,
            method="PATCH",
            body={"enabled": False},
        )
        _supabase_admin_request(
            "/rest/v1/focusflow_push_subscriptions?" + user_query,
            method="DELETE",
        )
        _supabase_admin_request(
            "/rest/v1/focusflow_user_data?user_id=eq."
            + urllib.parse.quote(user_id, safe=""),
            method="DELETE",
        )
    except SupabaseError as error:
        app.logger.error(
            "Could not disable account notifications or delete its FocusFlow data: user_id=%s status=%s message=%s",
            user_id,
            error.status,
            str(error),
        )
        flash("Your account could not be deleted. Your goal data was not removed; please try again later.", "error")
        return redirect(url_for("settings"))

    try:
        _supabase_admin_request(
            "/auth/v1/admin/users/" + urllib.parse.quote(user_id, safe=""),
            method="DELETE",
        )
    except SupabaseError as error:
        app.logger.error(
            "Could not delete Supabase Auth account after data deletion: user_id=%s status=%s message=%s",
            user_id,
            error.status,
            str(error),
        )
        flash(
            "Your FocusFlow data was deleted, but the account could not be removed. "
            "Please contact support before trying to log in again.",
            "error",
        )
        return redirect(url_for("settings"))

    session.clear()
    return redirect(url_for("landing", skip_intro=1))


@app.route("/support", methods=["GET", "POST"])
def support():
    user, response = _require_user()
    if response:
        return response

    csrf_token = session.setdefault("support_csrf_token", secrets.token_urlsafe(32))
    if request.method == "GET":
        return render_template(
            "support.html",
            user=user,
            csrf_token=csrf_token,
            subject="",
            message="",
        )

    submitted_token = request.form.get("csrf_token", "")
    if not secrets.compare_digest(csrf_token, submitted_token):
        abort(400)

    subject = request.form.get("subject", "").strip()
    message = request.form.get("message", "").strip()
    form_error = None
    if len(subject) > 200:
        form_error = "Please keep the subject to 200 characters or fewer."
    elif not message:
        form_error = "Please enter a message before sending."
    elif len(message) > 10000:
        form_error = "Please keep your message to 10,000 characters or fewer."

    if form_error:
        return render_template(
            "support.html",
            user=user,
            csrf_token=csrf_token,
            subject=subject,
            message=message,
            form_error=form_error,
        ), 400

    auth_session = _read_auth_session() or {}
    try:
        _supabase_request(
            "/rest/v1/focusflow_support_requests",
            method="POST",
            body={
                "user_id": user["id"],
                "email": user["email"],
                "subject": subject,
                "message": message,
            },
            access_token=auth_session.get("access_token"),
            extra_headers={"Prefer": "return=minimal"},
        )
    except SupabaseError as error:
        app.logger.error(
            "Could not save support request: user_id=%s status=%s message=%s",
            user["id"],
            error.status,
            str(error),
        )
        return render_template(
            "support.html",
            user=user,
            csrf_token=csrf_token,
            subject=subject,
            message=message,
            form_error="Your request could not be sent. Please try again.",
        ), 502

    flash("Your support request was sent. Thank you for reaching out.", "success")
    return redirect(url_for("support"))


if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG", "0") == "1")
