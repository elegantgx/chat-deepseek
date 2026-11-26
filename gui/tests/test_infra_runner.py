"""infra.runner：串行 lane、代际丢弃、取消与主线程回投。"""

from __future__ import annotations

import sys
import threading
import time
import unittest
from pathlib import Path
from types import MappingProxyType

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cdgui.domain.state import TaskKey
from cdgui.infra.runner import CancelToken, CommandRunner, QueuePump


def wait_until(predicate, timeout: float = 3.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("等待条件超时")


class QueuePumpTest(unittest.TestCase):
    def test_post_then_drain_runs_in_order(self) -> None:
        pump = QueuePump()
        seen: list[int] = []
        pump.post(lambda: seen.append(1))
        pump.post(lambda: seen.append(2))
        self.assertEqual(pump.drain(), 2)
        self.assertEqual(seen, [1, 2])
        self.assertEqual(pump.drain(), 0)

    def test_drain_isolates_callback_errors(self) -> None:
        pump = QueuePump()
        seen: list[str] = []

        def boom() -> None:
            raise RuntimeError("boom")

        pump.post(boom)
        pump.post(lambda: seen.append("after"))
        self.assertEqual(pump.drain(), 2)
        self.assertEqual(seen, ["after"])

    def test_close_drops_pending_and_rejects_post(self) -> None:
        pump = QueuePump()
        seen: list[int] = []
        pump.post(lambda: seen.append(1))
        pump.close()
        self.assertTrue(pump.closed)
        self.assertFalse(pump.post(lambda: seen.append(2)))
        self.assertEqual(pump.drain(), 0)
        self.assertEqual(seen, [])

    def test_post_from_worker_thread(self) -> None:
        pump = QueuePump()
        seen: list[int] = []

        def produce() -> None:
            for value in range(3):
                pump.post(lambda value=value: seen.append(value))

        thread = threading.Thread(target=produce)
        thread.start()
        thread.join()
        self.assertEqual(pump.pending, 3)
        pump.drain()
        self.assertEqual(seen, [0, 1, 2])


class CommandRunnerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.runner = CommandRunner("local|bin|data")
        self.addCleanup(self.runner.close)

    def test_runs_jobs_serially_in_order(self) -> None:
        order: list[str] = []
        done: list[str] = []

        def job(name: str):
            def run(_cancel: CancelToken) -> str:
                order.append(name + ":start")
                time.sleep(0.01)
                order.append(name + ":end")
                return name

            return run

        for name, key in (
            ("a", TaskKey.INFO),
            ("b", TaskKey.USERS),
            ("c", TaskKey.BACKUPS),
        ):
            self.runner.submit(
                key,
                job(name),
                on_success=done.append,
                blocking=False,
            )
        wait_until(lambda: not self.runner.inflight)
        self.assertEqual(order, ["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"])
        self.runner.pump.drain()
        self.assertEqual(done, ["a", "b", "c"])

    def test_blocking_submit_is_rejected_while_busy(self) -> None:
        release = threading.Event()
        started = threading.Event()

        def hold(_cancel: CancelToken) -> None:
            started.set()
            release.wait(3)

        first = self.runner.submit(
            TaskKey.INFO, hold, blocking=False
        )
        self.assertIsNotNone(first)
        self.assertTrue(started.wait(3))
        rejected = self.runner.submit(TaskKey.USERS, hold)
        self.assertIsNone(rejected)
        release.set()
        wait_until(lambda: not self.runner.inflight)

    def test_invalidate_drops_late_success(self) -> None:
        release = threading.Event()
        started = threading.Event()
        done: list[str] = []

        def hold(_cancel: CancelToken) -> str:
            started.set()
            release.wait(3)
            return "late"

        self.runner.submit(TaskKey.INFO, hold, on_success=done.append, blocking=False)
        self.assertTrue(started.wait(3))
        self.runner.invalidate(TaskKey.INFO)
        self.assertEqual(self.runner.inflight, {})
        release.set()
        wait_until(lambda: not self.runner.inflight)
        self.runner.pump.drain()
        self.assertEqual(done, [])

    def test_queued_job_is_dropped_after_invalidate(self) -> None:
        release = threading.Event()
        started = threading.Event()
        executed: list[str] = []

        def hold(_cancel: CancelToken) -> None:
            started.set()
            release.wait(3)

        def queued(_cancel: CancelToken) -> None:
            executed.append("queued")

        self.runner.submit(TaskKey.INFO, hold, blocking=False)
        self.assertTrue(started.wait(3))
        self.runner.submit(TaskKey.USERS, queued, blocking=False)
        self.runner.invalidate(TaskKey.USERS)
        release.set()
        wait_until(lambda: not self.runner.inflight)
        self.runner.pump.drain()
        self.assertEqual(executed, [])

    def test_cancel_token_stops_cooperative_job(self) -> None:
        started = threading.Event()
        done: list[str] = []

        def spin(cancel: CancelToken) -> str:
            started.set()
            while not cancel.cancelled:
                time.sleep(0.01)
            return "finished"

        token = self.runner.submit(
            TaskKey.INFO, spin, on_success=done.append, blocking=False
        )
        self.assertIsNotNone(token)
        self.assertTrue(started.wait(3))
        token.cancel()
        wait_until(lambda: not self.runner.inflight)
        self.runner.pump.drain()
        self.assertEqual(done, [])

    def test_failure_callback_receives_exception(self) -> None:
        seen: list[Exception] = []

        def boom(_cancel: CancelToken) -> None:
            raise RuntimeError("boom")

        self.runner.submit(TaskKey.INFO, boom, on_failure=seen.append)
        wait_until(lambda: not self.runner.inflight)
        self.runner.pump.drain()
        self.assertEqual(len(seen), 1)
        self.assertIsInstance(seen[0], RuntimeError)

    def test_inflight_snapshot_is_read_only_and_tagged(self) -> None:
        release = threading.Event()
        started = threading.Event()

        def hold(_cancel: CancelToken) -> None:
            started.set()
            release.wait(3)

        self.runner.submit(TaskKey.BACKUP, hold, blocking=False)
        self.assertTrue(started.wait(3))
        snapshot = self.runner.inflight
        self.assertIsInstance(snapshot, MappingProxyType)
        entry = snapshot[TaskKey.BACKUP]
        self.assertIs(entry.task_key, TaskKey.BACKUP)
        self.assertEqual(entry.target_key, "local|bin|data")
        self.assertGreaterEqual(entry.generation, 1)
        with self.assertRaises(TypeError):
            snapshot[TaskKey.INFO] = entry  # type: ignore[index]
        release.set()
        wait_until(lambda: not self.runner.inflight)

    def test_set_target_invalidates_everything(self) -> None:
        release = threading.Event()
        started = threading.Event()
        done: list[str] = []

        def hold(_cancel: CancelToken) -> str:
            started.set()
            release.wait(3)
            return "old"

        self.runner.submit(TaskKey.INFO, hold, on_success=done.append, blocking=False)
        self.assertTrue(started.wait(3))
        self.runner.set_target("ssh|nas|bin|data")
        self.assertEqual(self.runner.target_key, "ssh|nas|bin|data")
        self.assertEqual(self.runner.inflight, {})
        release.set()
        wait_until(lambda: not self.runner.inflight)
        self.runner.pump.drain()
        self.assertEqual(done, [])

    def test_close_drops_results_and_rejects_new_jobs(self) -> None:
        done: list[str] = []

        def slow(_cancel: CancelToken) -> str:
            time.sleep(0.05)
            return "late"

        self.runner.submit(TaskKey.INFO, slow, on_success=done.append, blocking=False)
        self.runner.close()
        self.assertTrue(self.runner.closed)
        self.assertTrue(self.runner.pump.closed)
        self.assertIsNone(self.runner.submit(TaskKey.INFO, slow))
        self.runner.pump.drain()
        self.assertEqual(done, [])


if __name__ == "__main__":
    unittest.main()
