#pragma once

#include "runtime.hpp"

#include <cstdint>

#include <hyprland/src/desktop/DesktopTypes.hpp>
#include <hyprland/src/render/pass/PassElement.hpp>
#include <hyprland/src/helpers/math/Math.hpp>

class CShinyPassElement : public IPassElement {
  public:
    struct SData {
        // Shared rounding / colors / logical thickness / alpha. Filled from
        // shinyMapDrawBackends().shader — not a parallel copy of those fields.
        // shared.borderSize is logical (unscaled) px. CShinyPassElement::draw
        // uploads shinyShaderThick(shared.borderSize, mon->m_scale, combinedScale()).
        // Rounding / outerRound are already monitor-scaled; draw multiplies
        // combinedScale() at upload. Do not store already-scaled borderSize.
        ShinyDrawShared shared;
        CBox            box;      // scaled, monitor-local, outer; includes m_floatingOffset
        float           angle   = 0.f; // drawn heading, radians: pinDeg + offset, plus shimmer
        float           time    = 0.f;
        float           pulseHz = 0.f; // 0 = pulse off (identity alpha on fallback)
        float           lobe    = 0.18f; // effective half-width; shimmer scale already applied
        float           thickScale = 1.f; // shimmer thickness modulation; 1 when not shimmering
        bool            mirror     = false; // same lobe on the far support; off = facing-only
        bool            customPos  = false; // gradient_positions applied; fallback resamples
        PHLWINDOWREF    window;             // CBorderPassElement fallback
    };

    CShinyPassElement(const SData& data);
    virtual ~CShinyPassElement();

    virtual std::vector<UP<IPassElement>> draw() override;
    virtual bool                          needsLiveBlur() override;
    virtual bool                          needsPrecomputeBlur() override;
    virtual std::optional<CBox>           boundingBox() override;
    virtual CRegion                       opaqueRegion() override;
    virtual bool                          disableSimplification() override;

    virtual const char*                   passName() override {
        return "CShinyPassElement";
    }

    virtual ePassElementType type() override {
        return EK_CUSTOM;
    }

    SData    m_data;
    uint64_t m_epoch = 0;
};

std::vector<UP<IPassElement>> shinyLinearFallbackElements(const CShinyPassElement::SData& data, float monitorScale);

bool     ensureShinyShader();
void     destroyShinyShader();
void     markShinyTeardown();
void     shinyResetLifecycle();
void     shinyOnPluginExit();
uint64_t shinyPassEpoch();
bool     shinyPassElementLive(uint64_t bornEpoch);
