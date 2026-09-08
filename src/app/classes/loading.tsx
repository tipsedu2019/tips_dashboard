import styles from "@/components/public/classes/public-classes.module.css";
export default function LoadingClasses() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="https://tipsedu.co.kr/">
          <strong>TIPS</strong>
          <span>팁스 영어·수학학원</span>
        </a>
      </header>
      <main className={styles.main}>
        <section className={styles.hero}>
          <h1>
            우리 아이에게 맞는
            <br />
            <span>수업을 찾아보세요.</span>
          </h1>
        </section>
        <p className={styles.loading} role="status">
          수업 정보를 불러오고 있습니다…
        </p>
      </main>
    </div>
  );
}
