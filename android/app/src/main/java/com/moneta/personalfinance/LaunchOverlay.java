package com.moneta.personalfinance;

import android.animation.ArgbEvaluator;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.LinearInterpolator;
import android.view.animation.OvershootInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;

/**
 * The native launch moment. It is drawn above the WebView so the first frame
 * after the system splash is already branded, theme-aware and animating.
 */
public class LaunchOverlay extends FrameLayout {

    private static final int LIGHT_BG = Color.rgb(244, 244, 242);
    private static final int DARK_BG = Color.rgb(11, 13, 16);
    private static final int LIGHT_INK = Color.rgb(23, 24, 25);
    private static final int DARK_INK = Color.rgb(244, 245, 247);
    private static final int LIGHT_MUTED = Color.rgb(119, 122, 124);
    private static final int DARK_MUTED = Color.argb(150, 244, 245, 247);
    private static final int LIGHT_TRACK = Color.argb(26, 23, 24, 25);
    private static final int DARK_TRACK = Color.argb(26, 255, 255, 255);
    private static final int MINT = Color.rgb(184, 233, 208);
    private static final int LIGHT_ACCENT = Color.rgb(39, 134, 91);

    private final LinearLayout column;
    private final ImageView icon;
    private final TextView word;
    private final TextView copy;
    private final LoadingLine line;
    private final GlowView glow;
    private final ArgbEvaluator argb = new ArgbEvaluator();

    private ValueAnimator colorAnimator;
    private ValueAnimator glowPulse;
    private boolean light;
    private boolean started;
    private boolean finished;

    private int bgColor;
    private int inkColor;
    private int mutedColor;
    private int trackColor;
    private int accentColor;

    public LaunchOverlay(@NonNull Context context, boolean light) {
        super(context);
        this.light = light;
        setClickable(true);
        setFocusable(true);

        column = new LinearLayout(context);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_HORIZONTAL);
        FrameLayout.LayoutParams columnLp = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        addView(column, columnLp);

        int box = dp(168);
        FrameLayout iconBox = new FrameLayout(context);
        column.addView(iconBox, new LinearLayout.LayoutParams(box, box));

        glow = new GlowView(context);
        iconBox.addView(glow, new FrameLayout.LayoutParams(box, box));

        int iconSize = dp(96);
        icon = new ImageView(context);
        icon.setImageResource(R.drawable.launch_logo);
        icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
        iconBox.addView(icon, new FrameLayout.LayoutParams(iconSize, iconSize, Gravity.CENTER));

        word = new TextView(context);
        word.setText("moneta");
        word.setTextSize(TypedValue.COMPLEX_UNIT_SP, 23);
        word.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        word.setLetterSpacing(-0.045f);
        word.setIncludeFontPadding(false);
        word.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams wordLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        wordLp.topMargin = dp(16);
        column.addView(word, wordLp);

        copy = new TextView(context);
        copy.setText("OPENING YOUR JOURNAL");
        copy.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        copy.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        copy.setLetterSpacing(0.16f);
        copy.setIncludeFontPadding(false);
        copy.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams copyLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        copyLp.topMargin = dp(13);
        column.addView(copy, copyLp);

        line = new LoadingLine(context);
        LinearLayout.LayoutParams lineLp = new LinearLayout.LayoutParams(dp(96), dp(2));
        lineLp.topMargin = dp(26);
        column.addView(line, lineLp);

        applyColors(false);
    }

    /** Switches between paper and ink while the launch screen is visible. */
    public void setLight(boolean light, boolean animate) {
        if (this.light == light) return;
        this.light = light;
        applyColors(animate && isAttachedToWindow());
    }

    public void start() {
        if (started || finished) return;
        started = true;

        glow.setAlpha(0f);
        icon.setAlpha(0f);
        icon.setScaleX(0.82f);
        icon.setScaleY(0.82f);
        icon.setTranslationY(dp(10));
        word.setAlpha(0f);
        word.setTranslationY(dp(10));
        copy.setAlpha(0f);
        copy.setTranslationY(dp(7));
        line.setAlpha(0f);

        glow.animate()
            .alpha(1f)
            .setStartDelay(40)
            .setDuration(900)
            .setInterpolator(new DecelerateInterpolator())
            .withEndAction(this::startGlowPulse)
            .start();
        icon.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .translationY(0f)
            .setStartDelay(40)
            .setDuration(760)
            .setInterpolator(new OvershootInterpolator(0.55f))
            .withLayer()
            .start();
        word.animate()
            .alpha(1f)
            .translationY(0f)
            .setStartDelay(200)
            .setDuration(560)
            .setInterpolator(new DecelerateInterpolator())
            .start();
        copy.animate()
            .alpha(1f)
            .translationY(0f)
            .setStartDelay(330)
            .setDuration(500)
            .setInterpolator(new DecelerateInterpolator())
            .start();
        line.animate()
            .alpha(1f)
            .setStartDelay(420)
            .setDuration(380)
            .start();
        line.postDelayed(line::start, 440);
    }

    /** Keeps the mint bloom breathing while the app finishes opening. */
    private void startGlowPulse() {
        if (finished || glowPulse != null) return;
        glowPulse = ValueAnimator.ofFloat(0f, 1f);
        glowPulse.setDuration(2400);
        glowPulse.setStartDelay(220);
        glowPulse.setRepeatCount(ValueAnimator.INFINITE);
        glowPulse.setRepeatMode(ValueAnimator.REVERSE);
        glowPulse.setInterpolator(new AccelerateDecelerateInterpolator());
        glowPulse.addUpdateListener(animation -> {
            float fraction = (float) animation.getAnimatedValue();
            float scale = 0.97f + fraction * 0.05f;
            glow.setScaleX(scale);
            glow.setScaleY(scale);
            glow.setAlpha(0.74f + fraction * 0.26f);
        });
        glowPulse.start();
    }

    public void fadeOut(Runnable onDone) {
        if (finished) {
            if (onDone != null) onDone.run();
            return;
        }
        finished = true;
        line.stop();
        if (colorAnimator != null) colorAnimator.cancel();
        if (glowPulse != null) {
            glowPulse.cancel();
            glowPulse = null;
        }
        glow.animate().cancel();

        column.animate()
            .translationY(-dp(12))
            .scaleX(1.015f)
            .scaleY(1.015f)
            .setDuration(520)
            .setInterpolator(new AccelerateDecelerateInterpolator())
            .start();
        animate()
            .alpha(0f)
            .setDuration(520)
            .setInterpolator(new AccelerateDecelerateInterpolator())
            .withEndAction(() -> {
                ViewParent parent = getParent();
                if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(this);
                if (onDone != null) onDone.run();
            })
            .start();
    }

    private void applyColors(boolean animate) {
        int targetBg = light ? LIGHT_BG : DARK_BG;
        int targetInk = light ? LIGHT_INK : DARK_INK;
        int targetMuted = light ? LIGHT_MUTED : DARK_MUTED;
        int targetTrack = light ? LIGHT_TRACK : DARK_TRACK;
        int targetAccent = light ? LIGHT_ACCENT : MINT;

        if (colorAnimator != null) {
            colorAnimator.cancel();
            colorAnimator = null;
        }
        if (!animate) {
            setColors(targetBg, targetInk, targetMuted, targetTrack, targetAccent);
            return;
        }

        final int fromBg = bgColor;
        final int fromInk = inkColor;
        final int fromMuted = mutedColor;
        final int fromTrack = trackColor;
        final int fromAccent = accentColor;
        colorAnimator = ValueAnimator.ofFloat(0f, 1f);
        colorAnimator.setDuration(260);
        colorAnimator.addUpdateListener(animation -> {
            float fraction = (float) animation.getAnimatedValue();
            setColors(
                (int) argb.evaluate(fraction, fromBg, targetBg),
                (int) argb.evaluate(fraction, fromInk, targetInk),
                (int) argb.evaluate(fraction, fromMuted, targetMuted),
                (int) argb.evaluate(fraction, fromTrack, targetTrack),
                (int) argb.evaluate(fraction, fromAccent, targetAccent)
            );
        });
        colorAnimator.start();
    }

    private void setColors(int bg, int ink, int muted, int track, int accent) {
        bgColor = bg;
        inkColor = ink;
        mutedColor = muted;
        trackColor = track;
        accentColor = accent;
        setBackgroundColor(bg);
        word.setTextColor(ink);
        copy.setTextColor(muted);
        line.setColors(track, accent);
        glow.setGlowColor(accent);
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            getResources().getDisplayMetrics()
        ));
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        line.stop();
        if (colorAnimator != null) colorAnimator.cancel();
        if (glowPulse != null) {
            glowPulse.cancel();
            glowPulse = null;
        }
    }

    /** A soft mint bloom behind the app icon. */
    private static final class GlowView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int color = MINT;
        private Shader shader;
        private int shaderColor = Color.TRANSPARENT;
        private int shaderWidth;
        private int shaderHeight;

        GlowView(Context context) {
            super(context);
        }

        void setGlowColor(int color) {
            if (this.color == color) return;
            this.color = color;
            shader = null;
            invalidate();
        }

        @Override
        protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
            super.onSizeChanged(width, height, oldWidth, oldHeight);
            shader = null;
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float width = getWidth();
            float height = getHeight();
            if (width <= 0 || height <= 0) return;
            if (shader == null
                || shaderColor != color
                || shaderWidth != (int) width
                || shaderHeight != (int) height) {
                float radius = Math.min(width, height) / 2f;
                int glow = Color.argb(52, Color.red(color), Color.green(color), Color.blue(color));
                int clear = Color.argb(0, Color.red(color), Color.green(color), Color.blue(color));
                shader = new RadialGradient(
                    width / 2f,
                    height / 2f,
                    radius,
                    new int[] { glow, clear },
                    null,
                    Shader.TileMode.CLAMP
                );
                shaderColor = color;
                shaderWidth = (int) width;
                shaderHeight = (int) height;
            }
            paint.setShader(shader);
            canvas.drawCircle(width / 2f, height / 2f, Math.min(width, height) / 2f, paint);
        }
    }

    /** The thin moving line at the bottom of the launch mark. */
    private static final class LoadingLine extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF rect = new RectF();
        private int trackColor = DARK_TRACK;
        private int accentColor = MINT;
        private ValueAnimator animator;
        private float progress;

        LoadingLine(Context context) {
            super(context);
        }

        void setColors(int track, int accent) {
            trackColor = track;
            accentColor = accent;
            invalidate();
        }

        void start() {
            if (animator != null) return;
            animator = ValueAnimator.ofFloat(0f, 1f);
            animator.setDuration(1500);
            animator.setRepeatCount(ValueAnimator.INFINITE);
            animator.setInterpolator(new LinearInterpolator());
            animator.addUpdateListener(animation -> {
                progress = (float) animation.getAnimatedValue();
                invalidate();
            });
            animator.start();
        }

        void stop() {
            if (animator == null) return;
            animator.cancel();
            animator = null;
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float width = getWidth();
            float height = getHeight();
            if (width <= 0 || height <= 0) return;
            float radius = height / 2f;

            paint.setColor(trackColor);
            rect.set(0f, 0f, width, height);
            canvas.drawRoundRect(rect, radius, radius, paint);

            float segment = width * 0.34f;
            float x = -segment + (width + segment) * progress;
            paint.setColor(accentColor);
            rect.set(x, 0f, x + segment, height);
            canvas.drawRoundRect(rect, radius, radius, paint);
        }
    }
}
