"use client";
import styles from "@/components/public/classes/public-classes.module.css";
export default function ClassesError({ reset }: { reset: () => void }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="https://tipsedu.co.kr/">
          <strong>TIPS</strong>
          <span>팁스 영어·수학학원</span>
        </a>
      </header>
      <main className={styles.main}>
        <div className={styles.empty} role="alert">
          <h1>수업 정보를 불러오지 못했습니다.</h1>
          <p>잠시 후 다시 시도해 주세요.</p>
          <button className={styles.primary} onClick={reset}>
            다시 불러오기
          </button>
        </div>
      </main>
    </div>
  );
}
