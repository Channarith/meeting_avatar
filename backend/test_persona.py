import unittest

from backend.persona_engine import (
    direct_address,
    fallback_reply,
    normalize_persona,
    resolve_xai_voice,
    scrub,
    speech_text,
    train_heuristic,
    worth_reply,
)


class PersonaTests(unittest.TestCase):
    def test_address_cue_and_question(self):
        self.assertTrue(direct_address("Chan, what's your take on the date?", ["Chan"]))
        self.assertTrue(direct_address("What do you think?", ["Chan"]))
        self.assertFalse(direct_address("Thanks", ["Chan"]))
        self.assertFalse(worth_reply("ok", ["Chan"]))
        self.assertTrue(worth_reply("Can you walk us through the rollout?", ["Chan"]))

    def test_scrub_hides_key_material(self):
        hidden = scrub("failed sk-proj-abcdefghijklmnopqrstuvwxyz and nvapi-abcdefghijklmnopqrstuvwxyz and xai-abcdefghijklmnopqrstuvwxyz")
        self.assertNotIn("sk-proj-abc", hidden)
        self.assertNotIn("nvapi-abc", hidden)
        self.assertNotIn("xai-abc", hidden)
        self.assertIn("[redacted]", hidden)
        account = scrub("Function 'abc': Not found for account 'secret-account-id'")
        self.assertNotIn("secret-account-id", account)
        self.assertNotIn("Function 'abc'", account)

    def test_train_extracts_question_and_answer(self):
        persona = normalize_persona({"name": "Chan", "address_cues": ["Chan"]})
        transcript = (
            "We should ship the fix this week because the customer is blocked.\n"
            "Who is owning the rollout?\n"
        )
        result = train_heuristic(persona, transcript)
        self.assertGreaterEqual(result["added"]["questions"], 1)
        self.assertGreaterEqual(result["added"]["answers"], 1)
        self.assertIn("owning the rollout", result["persona"]["question_examples"][-1]["question"])

    def test_fallback_uses_trained_answer(self):
        persona = normalize_persona(
            {
                "name": "Chan",
                "address_cues": ["Chan"],
                "answer_examples": [
                    {
                        "situation": "customer asked about the rollout date",
                        "answer": "I want the fix out this week, and I'll confirm the date after standup.",
                    }
                ],
                "question_examples": [
                    {"context": "rollout planning", "question": "Who is on point for the customer note?"}
                ],
            }
        )
        reply = fallback_reply(persona, "Chan, what is the rollout date for the customer?", [], "both")
        self.assertIn("this week", reply["answer"])
        self.assertIn("on point", reply["question"])
        self.assertTrue(reply["should_speak"])
        self.assertEqual(reply["source"], "persona")

    def test_male_xai_voice_resolution(self):
        persona = normalize_persona({"name": "Chan", "voice": "Samantha", "xai_custom_voice_id": "abcd1234"})
        self.assertEqual(persona["voice"], "rex")
        self.assertEqual(persona["xai_custom_voice_id"], "abcd1234")
        self.assertEqual(resolve_xai_voice("leo", persona), "leo")
        self.assertEqual(resolve_xai_voice("abcd1234", persona), "abcd1234")
        self.assertEqual(resolve_xai_voice("Samantha", persona), "abcd1234")
        self.assertEqual(resolve_xai_voice("", {}), "rex")

    def test_notes_keep_sentences_and_drop_single_letters(self):
        persona = normalize_persona({"name": "Chan", "notes": "This persona values clarity over a vague date."})
        self.assertEqual(persona["notes"], ["This persona values clarity over a vague date."])
        cleaned = normalize_persona({"name": "Chan", "notes": ["T", "h", "A real note about the customer date."]})
        self.assertEqual(cleaned["notes"], ["A real note about the customer date."])

    def test_typed_speech_keeps_every_sentence(self):
        typed = "First point. Second point. Third point. Fourth point. Fifth point stays."
        self.assertIn("Fifth point stays.", speech_text(typed, True))
        self.assertNotIn("Fifth", speech_text(typed, False))

    def test_fallback_without_training_does_not_invent(self):
        persona = normalize_persona({"name": "Chan"})
        reply = fallback_reply(persona, "What is the revenue number?", [], "answer")
        self.assertIn("don't have your wording", reply["answer"])


if __name__ == "__main__":
    unittest.main()
