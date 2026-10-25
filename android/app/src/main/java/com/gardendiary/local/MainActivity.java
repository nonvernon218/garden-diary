package com.gardendiary.local;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PhotoLinksPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
