import { useState } from 'react';
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
import Constants from 'expo-constants';

const API_BASE_URL = Constants.expoConfig?.extra?.apiBaseUrl ?? 'https://YOUR-BACKEND-URL.example.com';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);

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
    try {
      const res = await fetch(`${API_BASE_URL}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          format_id: format.format_id,
          type: format.type,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Download failed');
      }

      const blob = await res.blob();
      const base64 = await blobToBase64(blob);
      const ext = format.type === 'audio' ? 'mp3' : 'mp4';
      const fileUri = `${FileSystem.cacheDirectory}vidsnatch_${Date.now()}.${ext}`;
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      }
    } catch (e) {
      setError(e.message || 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        <Text style={styles.title}>VidSnatch</Text>
        <Text style={styles.subtitle}>YouTube, Instagram, TikTok, Snapchat & Twitter</Text>

        <TextInput
          style={styles.input}
          placeholder="Paste a video URL..."
          placeholderTextColor="#64748b"
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
            <Text style={styles.buttonText}>Get Video</Text>
          )}
        </Pressable>

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
                  disabled={downloadingId === item.format_id}
                >
                  <Text style={styles.formatLabel}>{item.label}</Text>
                  {downloadingId === item.format_id ? (
                    <ActivityIndicator />
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
  safe: { flex: 1, backgroundColor: '#0f172a' },
  container: { flex: 1, padding: 20, paddingTop: Platform.OS === 'android' ? 30 : 10 },
  title: { fontSize: 32, fontWeight: '800', color: '#fff', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#94a3b8', textAlign: 'center', marginBottom: 20 },
  input: {
    backgroundColor: '#1e293b',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  error: { color: '#f87171', marginTop: 12, textAlign: 'center' },
  result: { marginTop: 20, flex: 1 },
  thumb: { width: '100%', height: 200, borderRadius: 12, marginBottom: 10 },
  videoTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  formatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  formatLabel: { color: '#e2e8f0', fontSize: 14 },
  downloadIcon: { color: '#6366f1', fontSize: 18 },
});
