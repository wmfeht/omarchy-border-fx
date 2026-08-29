#pragma once

#include "runtime.hpp"

#include <chrono>
#include <optional>

#include <hyprland/src/render/decorations/IHyprWindowDecoration.hpp>
#include <hyprland/src/desktop/DesktopTypes.hpp>
#include <hyprland/src/managers/eventLoop/EventLoopTimer.hpp>

class CShinyBorder : public IHyprWindowDecoration {
  public:
    CShinyBorder(PHLWINDOW window);
    virtual ~CShinyBorder();

    virtual SDecorationPositioningInfo getPositioningInfo() override;
    virtual void                       onPositioningReply(const SDecorationPositioningReply& reply) override;
    virtual void                       draw(PHLMONITOR pMonitor, float const& a) override;
    virtual eDecorationType            getDecorationType() override;
    virtual void                       updateWindow(PHLWINDOW pWindow) override;
    virtual void                       damageEntire() override;
    virtual eDecorationLayer           getDecorationLayer() override;
    virtual uint64_t                   getDecorationFlags() override;
    virtual std::string                getDisplayName() override;

    void                               syncPulse();
    void                               syncExtents();

  private:
    PHLWINDOWREF        m_window;
    CBox                m_assignedGeometry = {};
    SBoxExtents         m_extents          = {};
    Vector2D            m_lastPos;
    Vector2D            m_lastSize;
    int                 m_lastEffectiveB = -1;  // last reserved extent px
    SP<CEventLoopTimer> m_pulseTimer;           // drives pulse *or* shimmer damage
    ShinyShimmerState   m_shimmer;
    // dt source for shimmer steps. Reset whenever the timer stops so a
    // long idle gap does not become one giant step on re-arm.
    std::optional<std::chrono::steady_clock::time_point> m_lastShimmerTick;

    int                 borderSize() const;
    int                 effectiveBorderSize() const;
    CBox                assignedBoxGlobal();
    ShinyEffect         effectMode() const;
    ShinyShimmerParams  shimmerParams() const;
    bool                rippleOn() const;
    bool                pulseWanted() const;
    void                startPulse();
    void                stopPulse();
    void                onPulseTick(SP<CEventLoopTimer> self);
};
