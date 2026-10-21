import io
import json
import struct
import unittest
import wave

from backend.a2f_client import ace_status, animate_wav, face_motion_summary, parse_endpoint, pcm16_mono


class Audio2FaceTests(unittest.TestCase):
    def test_local_endpoint_is_insecure(self):
        self.assertEqual(parse_endpoint("127.0.0.1:52000"), ("127.0.0.1", 52000, False))
        self.assertEqual(parse_endpoint(""), ("127.0.0.1", 52000, False))

    def test_cloud_endpoint_is_secure(self):
        host, port, secure = parse_endpoint("grpcs://grpc.nvcf.nvidia.com:443")
        self.assertEqual(host, "grpc.nvcf.nvidia.com")
        self.assertEqual(port, 443)
        self.assertTrue(secure)

    def test_status_hides_the_key_and_does_not_claim_a_connection(self):
        secret = "nvapi-secretvalue1234567890"
        status = ace_status({"a2f_url": "127.0.0.1:1", "a2f_api_key": secret}, timeout=0.2)
        blob = json.dumps(status)
        self.assertNotIn(secret, blob)
        self.assertNotIn("secretvalue", blob)
        self.assertEqual(status["component"], "Audio2Face-3D")
        self.assertFalse(status["connected"])
        self.assertFalse(status["listening"])
        self.assertTrue(status["key_set"])
        self.assertTrue(status["library"])
        self.assertIn("has not been sent", status["detail"])

    def test_closed_port_returns_no_frames(self):
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(16000)
            handle.writeframes(struct.pack("<160h", *([0] * 160)))
        result = animate_wav(buffer.getvalue(), {"a2f_url": "127.0.0.1:1"})
        self.assertFalse(result["ok"])
        self.assertFalse(result["connected"])
        self.assertEqual(result["frames"], [])
        self.assertNotIn("nvapi", json.dumps(result))

    def test_motion_summary_requires_a_real_mouth_move(self):
        closed = face_motion_summary([{"time": 0.0, "weights": {"jawOpen": 0.01}}, {"time": 0.1, "weights": {"jawOpen": 0.02}}])
        self.assertFalse(closed["moved"])
        opened = face_motion_summary(
            [
                {"time": 0.0, "weights": {"jawOpen": 0.1, "eyeBlinkLeft": 0.9}},
                {"time": 1.25, "weights": {"jawOpen": 0.58, "mouthFunnel": 0.2}},
            ]
        )
        self.assertTrue(opened["moved"])
        self.assertEqual(opened["strongest"], "jawOpen")
        self.assertEqual(opened["peak"], 0.58)
        self.assertEqual(opened["frames"], 2)
        self.assertEqual(opened["duration"], 1.25)
        self.assertFalse(face_motion_summary([])["moved"])

    def test_pcm_helper_keeps_the_sample_rate(self):
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(24000)
            handle.writeframes(struct.pack("<8h", 1, -1, 2, -2, 3, -3, 4, -4))
        rate, pcm = pcm16_mono(buffer.getvalue())
        self.assertEqual(rate, 24000)
        self.assertEqual(len(pcm), 16)


if __name__ == "__main__":
    unittest.main()
