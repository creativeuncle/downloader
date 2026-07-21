import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import Constants from 'expo-constants';
import { useFonts, Kalam_400Regular, Kalam_700Bold } from '@expo-google-fonts/kalam';

const API_BASE_URL = Constants.expoConfig?.extra?.apiBaseUrl ?? 'https://YOUR-BACKEND-URL.example.com';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

function blobToText(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });
}

// POST with a JSON body while tracking response download progress —
// FileSystem.downloadAsync doesn't support a POST body, so this goes
// through XMLHttpRequest directly.
function downloadWithProgress(url, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.responseType = 'blob';
    xhr.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
        return;
      }
      try {
        const text = await blobToText(xhr.response);
        const data = JSON.parse(text);
        reject(new Error(data.error || 'Download failed'));
      } catch {
        reject(new Error('Download failed'));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(JSON.stringify(body));
  });
}

export default function App() {
  const [fontsLoaded] = useFonts({ Kalam_400Regular, Kalam_700Bold });
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);

  useEffect(() => {
    MediaLibrary.requestPermissionsAsync(true);
  }, []);

  async function fetchInfo() {
    if (!url.trim()) return;
    setError('');
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setInfo(data);
    } catch (e) {
      setError(e.message || 'Failed to fetch video info');
    } finally {
      setLoading(false);
    }
  }

  async function downloadFormat(format) {
    setError('');
    setDownloadingId(format.format_id);
    setProgress(0);
    try {
      const blob = await downloadWithProgress(
        `${API_BASE_URL}/api/download`,
        { url: url.trim(), format_id: format.format_id, type: format.type },
        setProgress
      );

      const base64 = await blobToBase64(blob);
      const ext = format.type === 'audio' ? 'mp3' : 'mp4';
      const fileUri = `${FileSystem.cacheDirectory}vidsnatch_${Date.now()}.${ext}`;
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status === 'granted') {
        await MediaLibrary.saveToLibraryAsync(fileUri);
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      }
    } catch (e) {
      setError(e.message || 'Download failed');
    } finally {
      setDownloadingId(null);
      setProgress(0);
    }
  }

  if (!fontsLoaded) return null;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        <Text style={styles.title}>Social Video{'\n'}Downloader</Text>

        <TextInput
          style={styles.input}
          placeholder="Enter url"
          placeholderTextColor="#9ca3af"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <Pressable style={styles.button} onPress={fetchInfo} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Download</Text>
          )}
        </Pressable>

        {downloadingId && (
          <View style={styles.progressWrap}>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
          </View>
        )}

        {!!error && <Text style={styles.error}>{error}</Text>}

        {info && (
          <View style={styles.result}>
            {!!info.thumbnail && (
              <Image source={{ uri: info.thumbnail }} style={styles.thumb} />
            )}
            <Text style={styles.videoTitle} numberOfLines={2}>{info.title}</Text>

            <FlatList
              data={info.formats}
              keyExtractor={(item) => item.format_id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.formatRow}
                  onPress={() => downloadFormat(item)}
                  disabled={!!downloadingId}
                >
                  <Text style={styles.formatLabel}>{item.label}</Text>
                  {downloadingId === item.format_id ? (
                    <ActivityIndicator color="#111827" />
                  ) : (
                    <Text style={styles.downloadIcon}>⬇</Text>
                  )}
                </Pressable>
              )}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, padding: 24, paddingTop: Platform.OS === 'android' ? 60 : 40 },
  title: {
    fontFamily: 'Kalam_700Bold',
    fontSize: 34,
    color: '#111827',
    textAlign: 'center',
    lineHeight: 40,
    marginBottom: 32,
  },
  input: {
    borderWidth: 2,
    borderColor: '#111827',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#111827',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  progressWrap: { marginTop: 16 },
  progressBg: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#111827',
    borderRadius: 5,
  },
  progressText: { textAlign: 'center', marginTop: 6, color: '#374151', fontSize: 13 },
  error: { color: '#dc2626', marginTop: 16, textAlign: 'center' },
  result: { marginTop: 24, flex: 1 },
  thumb: { width: '100%', height: 200, borderRadius: 12, marginBottom: 10 },
  videoTitle: { color: '#111827', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  formatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  formatLabel: { color: '#111827', fontSize: 14 },
  downloadIcon: { color: '#111827', fontSize: 18 },
});
