"""
Tests for metrics.py helpers added while addressing PR feedback:
  - _utcnow / _utc_from_ms / _iso_z are non-deprecated and preserve the 'Z' format
  - _job_s3_output extracts (bucket, prefix) and dedupes the repeated logic

boto3 is mocked so metrics.py imports without AWS access.

Run from agentic-atx-platform/api/lambda:
    python3 -m unittest discover -s tests -v
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))


def _import_metrics():
    boto3_mock = mock.MagicMock()
    with mock.patch.dict(sys.modules, {'boto3': boto3_mock}):
        sys.modules.pop('metrics', None)
        import metrics
        return metrics


class TestDatetimeHelpers(unittest.TestCase):
    def setUp(self):
        self.m = _import_metrics()

    def test_iso_z_format(self):
        # _iso_z output must end with Z and not contain a +00:00 offset.
        s = self.m._iso_z(self.m._utcnow())
        self.assertTrue(s.endswith('Z'), s)
        self.assertNotIn('+00:00', s)

    def test_utc_from_ms(self):
        # 2021-01-01T00:00:00Z == 1609459200000 ms
        dt = self.m._utc_from_ms(1609459200000)
        self.assertEqual(dt.year, 2021)
        self.assertEqual(dt.month, 1)
        self.assertEqual(dt.day, 1)

    def test_no_deprecated_utcnow_in_source(self):
        # Guard against regressions to the deprecated APIs. Ignore comment lines
        # (the helper docstrings intentionally mention the deprecated names).
        src_lines = open(os.path.join(os.path.dirname(__file__), '..', 'metrics.py')).read().splitlines()
        code = '\n'.join(l for l in src_lines if not l.lstrip().startswith('#') and '"""' not in l)
        self.assertNotIn('datetime.utcnow(', code)
        self.assertNotIn('.utcfromtimestamp(', code)


class TestJobS3Output(unittest.TestCase):
    def setUp(self):
        self.m = _import_metrics()

    def test_extracts_bucket_and_prefix(self):
        job = {
            'container': {
                'environment': [{'name': 'S3_BUCKET', 'value': 'my-bucket'}],
                'command': ['--output', 'transformations/my-job/', '--command', 'atx ...'],
            }
        }
        bucket, prefix = self.m._job_s3_output(job)
        self.assertEqual(bucket, 'my-bucket')
        self.assertEqual(prefix, 'transformations/my-job/')

    def test_defaults_when_missing(self):
        bucket, prefix = self.m._job_s3_output({'container': {}})
        self.assertIsNone(bucket)
        self.assertEqual(prefix, 'transformations/')


if __name__ == '__main__':
    unittest.main()
