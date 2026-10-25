package com.gardendiary.local;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(name = "PhotoLinks")
public class PhotoLinksPlugin extends Plugin {
    private static final String CAMERA_FILE_KEY = "pending_camera_file";
    private String pendingCameraFile;

    private File photoFolder() {
        File folder = new File(getContext().getFilesDir(), "captured_photos");
        if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("无法创建照片文件夹");
        return folder;
    }

    private Uri fileUri(File file) {
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
    }

    private void rememberCameraFile(String name) {
        getContext().getSharedPreferences("photo_links", 0).edit()
            .putString(CAMERA_FILE_KEY, name).apply();
        pendingCameraFile = name;
    }

    private File cameraFile() {
        String name = pendingCameraFile != null ? pendingCameraFile
            : getContext().getSharedPreferences("photo_links", 0).getString(CAMERA_FILE_KEY, null);
        return name == null ? null : new File(photoFolder(), name);
    }

    private boolean hasPhotoBytes(File file) {
        if (file == null || file.length() == 0) return false;
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
        return bounds.outWidth > 0 && bounds.outHeight > 0;
    }

    @PluginMethod
    public void pickPhoto(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.setType("image/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "pickedPhoto");
        } catch (Exception exception) {
            call.reject("无法打开相册", exception);
        }
    }

    @ActivityCallback
    private void pickedPhoto(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri uri = result.getData().getData();
        try {
            int takeFlags = result.getData().getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
            getContext().getContentResolver().takePersistableUriPermission(uri, takeFlags);
            JSObject out = new JSObject();
            out.put("uri", uri.toString());
            out.put("name", displayName(uri));
            call.resolve(out);
        } catch (Exception exception) {
            call.reject("无法保留照片访问权限", exception);
        }
    }

    @PluginMethod
    public void takePhoto(PluginCall call) {
        String name = "IMG_" + new SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.ROOT).format(new Date()) + ".jpg";
        try {
            File file = new File(photoFolder(), name);
            if (!file.createNewFile()) throw new IllegalStateException("无法创建照片文件");
            rememberCameraFile(name);
            Uri uri = fileUri(file);
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
            intent.setClipData(ClipData.newRawUri("photo", uri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            startActivityForResult(call, intent, "capturedPhoto");
        } catch (Exception exception) {
            File file = cameraFile();
            if (file != null) file.delete();
            rememberCameraFile(null);
            call.reject("无法打开相机", exception);
        }
    }

    @ActivityCallback
    private void capturedPhoto(PluginCall call, ActivityResult result) {
        File file = cameraFile();
        if (file == null) {
            if (call != null) call.reject("拍照结果丢失，请重试");
            return;
        }
        rememberCameraFile(null);
        try {
            if (!hasPhotoBytes(file) && result.getResultCode() == Activity.RESULT_OK && result.getData() != null
                && result.getData().getExtras() != null) {
                Object thumbnail = result.getData().getExtras().get("data");
                if (thumbnail instanceof Bitmap) {
                    try (FileOutputStream output = new FileOutputStream(file)) {
                        ((Bitmap) thumbnail).compress(Bitmap.CompressFormat.JPEG, 92, output);
                    }
                }
            }
            if (!hasPhotoBytes(file)) {
                file.delete();
                if (call != null) call.reject(result.getResultCode() == Activity.RESULT_OK ? "相机没有返回照片，请重试" : "cancelled");
                return;
            }
            JSObject out = new JSObject();
            out.put("uri", fileUri(file).toString());
            out.put("name", file.getName());
            if (call != null) call.resolve(out);
        } catch (Exception exception) {
            file.delete();
            if (call != null) call.reject("无法保存照片", exception);
        }
    }

    @PluginMethod
    public void pruneCapturedPhotos(PluginCall call) {
        JSArray refs = call.getArray("uris");
        if (refs == null) { call.reject("缺少照片引用"); return; }
        Set<String> keep = new HashSet<>();
        for (int i = 0; i < refs.length(); i++) keep.add(refs.optString(i));
        File[] files = photoFolder().listFiles();
        File pending = cameraFile();
        if (files != null) for (File file : files) {
            if (pending != null && file.equals(pending)) continue;
            if (!keep.contains(fileUri(file).toString())) file.delete();
        }
        call.resolve();
    }

    @PluginMethod
    public void readPhoto(PluginCall call) {
        String value = call.getString("uri");
        if (value == null || !value.startsWith("content://")) {
            call.reject("照片地址无效");
            return;
        }
        Uri uri = Uri.parse(value);
        int maxWidth = Math.max(320, Math.min(call.getInt("maxWidth", 1200), 2400));
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                BitmapFactory.decodeStream(input, null, bounds);
            }
            int sample = 1;
            while (bounds.outWidth / sample > maxWidth * 1.5 || bounds.outHeight / sample > maxWidth * 2.5) sample *= 2;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sample;
            Bitmap bitmap;
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                bitmap = BitmapFactory.decodeStream(input, null, options);
            }
            if (bitmap == null) throw new IllegalStateException("无法读取照片");
            int rotation = 0;
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                ExifInterface exif = new ExifInterface(input);
                int orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                if (orientation == ExifInterface.ORIENTATION_ROTATE_90) rotation = 90;
                else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) rotation = 180;
                else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) rotation = 270;
            } catch (Exception ignored) {}
            if (rotation != 0) {
                Matrix matrix = new Matrix();
                matrix.postRotate(rotation);
                Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
                if (rotated != bitmap) bitmap.recycle();
                bitmap = rotated;
            }
            if (bitmap.getWidth() > maxWidth) {
                int height = Math.round(bitmap.getHeight() * maxWidth / (float) bitmap.getWidth());
                Bitmap smaller = Bitmap.createScaledBitmap(bitmap, maxWidth, height, true);
                if (smaller != bitmap) bitmap.recycle();
                bitmap = smaller;
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 84, output);
            bitmap.recycle();
            JSObject out = new JSObject();
            out.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
            call.resolve(out);
        } catch (Exception exception) {
            call.reject("无法打开照片，原图可能已被删除或移动", exception);
        }
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) {}
        return "照片";
    }
}
