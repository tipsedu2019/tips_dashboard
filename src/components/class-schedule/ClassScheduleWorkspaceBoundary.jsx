import { Component } from "react";

export default class ClassScheduleWorkspaceBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("Class schedule workspace render failed:", error);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="class-schedule-empty-state">
          수업일정 화면을 불러오는 중 문제가 발생했습니다. 다시 열거나 필터를 바꿔 주세요.
        </div>
      );
    }

    return this.props.children;
  }
}
